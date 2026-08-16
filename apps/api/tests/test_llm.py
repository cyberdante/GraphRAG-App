"""The answer-generation layer.

The litellm path is tested against a stub module rather than a live provider:
what matters here is the request we build and how we read the stream back, and
both are verifiable without spending a token or holding a key.
"""

import sys
import types

import pytest

from app.config import Settings
from app.llm.context import citations_for, cited_indices, render_context
from app.llm.fixture import FixtureAnswerGenerator
from app.llm.generator import AnswerGenerator
from app.llm.litellm_generator import LiteLLMAnswerGenerator
from app.llm.registry import build_generator, resolve_model
from app.models import Message
from app.retrieval.models import Candidate


def candidate(text: str, confidence: float | None = 0.9) -> Candidate:
    return Candidate(kind="statement", text=text, confidence=confidence, source="graph")


def message(role: str, content: str) -> Message:
    return Message(
        id=f"m-{role}-{content[:4]}",
        role=role,
        content=content,
        timestamp="2026-08-16T00:00:00Z",
    )


class TestContextRendering:
    def test_numbers_the_evidence_so_it_can_be_cited(self) -> None:
        rendered = render_context([candidate("A supplies B"), candidate("B ships C")])

        assert rendered.startswith("[1] A supplies B")
        assert "[2] B ships C" in rendered

    def test_includes_confidence_when_the_store_reports_it(self) -> None:
        assert "confidence 0.90" in render_context([candidate("x")])

    def test_omits_confidence_rather_than_inventing_one(self) -> None:
        assert "confidence" not in render_context([candidate("x", confidence=None)])


class TestCitationExtraction:
    def test_reads_single_and_grouped_markers(self) -> None:
        assert cited_indices("Grounded [1] and also [2, 3].") == [1, 2, 3]

    def test_keeps_first_appearance_order_without_repeats(self) -> None:
        assert cited_indices("[3] then [1] then [3] again") == [3, 1]

    def test_returns_only_what_the_answer_leaned_on(self) -> None:
        top = [candidate("first"), candidate("second"), candidate("third")]
        cited = citations_for("Only the middle one matters [2].", top)

        assert [item.text for item in cited] == ["second"]

    def test_an_answer_citing_nothing_gets_everything(self) -> None:
        # A model that cites nothing is a prompt or model failure; hiding the
        # evidence would make that harder to see, not better.
        top = [candidate("first"), candidate("second")]
        assert citations_for("No markers here at all.", top) == top

    def test_ignores_a_marker_pointing_past_the_evidence(self) -> None:
        top = [candidate("only one")]
        assert [item.text for item in citations_for("Claim [7].", top)] == ["only one"]


class TestFixtureGenerator:
    @pytest.fixture
    def generator(self) -> FixtureAnswerGenerator:
        return FixtureAnswerGenerator(token_delay=0.0)

    def test_satisfies_the_port(self, generator: FixtureAnswerGenerator) -> None:
        assert isinstance(generator, AnswerGenerator)

    @pytest.mark.anyio
    async def test_streams_increments_that_reassemble(
        self, generator: FixtureAnswerGenerator
    ) -> None:
        usage: dict[str, int] = {}
        pieces = [
            piece
            async for piece in generator.stream(
                "which suppliers are at risk?", "", [message("user", "q")], usage
            )
        ]

        assert len(pieces) > 1
        assert "ITAMCO" in "".join(pieces)
        assert usage["output_tokens"] > 0


class FakeChunk:
    """Mimics one litellm streaming chunk."""

    def __init__(self, text: str | None = None, usage: object | None = None) -> None:
        delta = types.SimpleNamespace(content=text)
        self.choices = [types.SimpleNamespace(delta=delta)] if text is not None else []
        self.usage = usage


class FakeStream:
    def __init__(self, chunks: list[FakeChunk]) -> None:
        self._chunks = chunks

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for chunk in self._chunks:
            yield chunk


def install_fake_litellm(monkeypatch, chunks: list[FakeChunk]) -> dict:
    """Puts a stub litellm on sys.modules and records the call it receives."""
    captured: dict = {}

    async def acompletion(**kwargs):
        captured.update(kwargs)
        return FakeStream(chunks)

    module = types.ModuleType("litellm")
    module.acompletion = acompletion  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "litellm", module)
    return captured


class TestLiteLLMGenerator:
    @pytest.mark.anyio
    async def test_streams_text_and_captures_usage(self, monkeypatch) -> None:
        usage_report = types.SimpleNamespace(prompt_tokens=120, completion_tokens=45)
        install_fake_litellm(
            monkeypatch,
            [FakeChunk("Suppliers "), FakeChunk("at risk."), FakeChunk(usage=usage_report)],
        )

        generator = LiteLLMAnswerGenerator(model="anthropic/claude-opus-5")
        usage: dict[str, int] = {}
        text = "".join(
            [
                piece
                async for piece in generator.stream(
                    "q", "[1] a fact", [message("user", "q")], usage
                )
            ]
        )

        assert text == "Suppliers at risk."
        assert usage == {"input_tokens": 120, "output_tokens": 45}

    @pytest.mark.anyio
    async def test_sends_the_evidence_with_the_question(self, monkeypatch) -> None:
        captured = install_fake_litellm(monkeypatch, [FakeChunk("ok")])
        generator = LiteLLMAnswerGenerator(model="anthropic/claude-opus-5")

        async for _ in generator.stream("Why?", "[1] because", [message("user", "Why?")], {}):
            pass

        messages = captured["messages"]
        assert messages[0]["role"] == "system"
        assert "cite" in messages[0]["content"].lower()
        assert messages[-1]["content"] == "Facts:\n[1] because\n\nQuestion: Why?"

    @pytest.mark.anyio
    async def test_carries_prior_turns_so_follow_ups_resolve(self, monkeypatch) -> None:
        captured = install_fake_litellm(monkeypatch, [FakeChunk("ok")])
        generator = LiteLLMAnswerGenerator(model="anthropic/claude-opus-5")
        history = [
            message("user", "which suppliers are at risk?"),
            message("assistant", "ITAMCO and TechParts."),
            message("user", "what about the second one?"),
        ]

        async for _ in generator.stream("what about the second one?", "[1] x", history, {}):
            pass

        roles = [entry["role"] for entry in captured["messages"]]
        assert roles == ["system", "user", "assistant", "user"]

    @pytest.mark.anyio
    async def test_omits_temperature_unless_asked(self, monkeypatch) -> None:
        # The Claude 5 family rejects `temperature` with a 400, so sending a
        # default would break the recommended model rather than tune it.
        captured = install_fake_litellm(monkeypatch, [FakeChunk("ok")])
        generator = LiteLLMAnswerGenerator(model="anthropic/claude-opus-5")

        async for _ in generator.stream("q", "", [message("user", "q")], {}):
            pass

        assert "temperature" not in captured

    @pytest.mark.anyio
    async def test_sends_temperature_when_a_deployment_sets_one(self, monkeypatch) -> None:
        captured = install_fake_litellm(monkeypatch, [FakeChunk("ok")])
        generator = LiteLLMAnswerGenerator(model="openai/gpt-5", temperature=0.2)

        async for _ in generator.stream("q", "", [message("user", "q")], {}):
            pass

        assert captured["temperature"] == 0.2

    @pytest.mark.anyio
    async def test_asks_for_usage_on_the_stream(self, monkeypatch) -> None:
        # Without this most providers stream tokens and report nothing, so the
        # trace panel would have no numbers to show.
        captured = install_fake_litellm(monkeypatch, [FakeChunk("ok")])
        generator = LiteLLMAnswerGenerator(model="anthropic/claude-opus-5")

        async for _ in generator.stream("q", "", [message("user", "q")], {}):
            pass

        assert captured["stream"] is True
        assert captured["stream_options"] == {"include_usage": True}


class TestRegistry:
    def test_falls_back_to_fixtures_without_credentials(self, monkeypatch) -> None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        assert build_generator(Settings()).name == "fixtures"

    def test_uses_a_model_when_a_key_is_configured(self, monkeypatch) -> None:
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        assert build_generator(Settings()).name == "model"

    def test_reads_the_provider_s_own_environment_variable(self, monkeypatch) -> None:
        # An existing shell environment should work untouched.
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

        assert build_generator(Settings(llm_provider="openai")).name == "model"

    def test_an_explicit_setting_beats_the_environment(self, monkeypatch) -> None:
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        assert build_generator(Settings(llm_api_key="sk-explicit")).name == "model"

    def test_defaults_the_model_per_provider(self) -> None:
        assert resolve_model(Settings()) == "anthropic/claude-opus-5"
        assert resolve_model(Settings(llm_provider="openai")).startswith("openai/")

    def test_a_named_model_wins(self) -> None:
        assert resolve_model(Settings(llm_model="anthropic/claude-haiku-4-5")) == (
            "anthropic/claude-haiku-4-5"
        )
