"""The streaming contract, asserted on frames rather than prose.

These tests deliberately check the shape and order of the event sequence, not
the wording of the answer. When Bedrock and Neptune replace the fixtures, the
answers change completely and every one of these should still pass.
"""

import json

from fastapi.testclient import TestClient


def frames(raw: str) -> list[tuple[str, dict]]:
    """Split an SSE response body into (event, parsed data) pairs."""
    parsed = []
    for block in raw.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event = ""
        data_lines = []
        for line in block.split("\n"):
            if line.startswith("event: "):
                event = line[len("event: ") :]
            elif line.startswith("data: "):
                data_lines.append(line[len("data: ") :])
        parsed.append((event, json.loads("\n".join(data_lines))))
    return parsed


def stream(client: TestClient, body: dict) -> list[tuple[str, dict]]:
    response = client.post("/api/query", json=body)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return frames(response.text)


class TestHealth:
    def test_reports_ok(self, client: TestClient) -> None:
        assert client.get("/health").json()["status"] == "ok"


class TestStreamShape:
    def test_emits_the_documented_event_sequence(
        self, client: TestClient, query_body: dict
    ) -> None:
        events = [event for event, _ in stream(client, query_body)]

        assert events[0] == "status"
        assert events[-1] == "done"
        assert "graph" in events
        assert "delta" in events
        # Retrieval must be reported before the answer starts arriving.
        assert events.index("status") < events.index("delta")
        assert events.index("graph") < events.index("delta")

    def test_sends_exactly_one_done_frame(self, client: TestClient, query_body: dict) -> None:
        events = [event for event, _ in stream(client, query_body)]
        assert events.count("done") == 1

    def test_emits_no_error_frame_on_the_happy_path(
        self, client: TestClient, query_body: dict
    ) -> None:
        events = [event for event, _ in stream(client, query_body)]
        assert "error" not in events


class TestDeltas:
    def test_deltas_are_increments_that_reassemble_into_the_answer(
        self, client: TestClient, query_body: dict
    ) -> None:
        # The contract is increments, not a running total: a client appends.
        # Sending cumulative text would make the reassembled answer quadratic.
        deltas = [data["text"] for event, data in stream(client, query_body) if event == "delta"]
        answer = "".join(deltas)

        assert len(deltas) > 1
        assert "ITAMCO" in answer
        assert not deltas[1].startswith(deltas[0])

    def test_answer_is_markdown(self, client: TestClient, query_body: dict) -> None:
        answer = "".join(
            data["text"] for event, data in stream(client, query_body) if event == "delta"
        )
        assert "**" in answer


class TestGraphFrames:
    def test_graph_frames_are_internally_consistent(
        self, client: TestClient, query_body: dict
    ) -> None:
        # Every link must land on nodes present in the same frame, or the
        # visualization draws edges into empty space.
        for event, data in stream(client, query_body):
            if event != "graph":
                continue
            node_ids = {node["id"] for node in data["nodes"]}
            for link in data["links"]:
                assert link["source"] in node_ids
                assert link["target"] in node_ids

    def test_graph_grows_from_a_partial_view_to_the_full_one(
        self, client: TestClient, query_body: dict
    ) -> None:
        graphs = [data for event, data in stream(client, query_body) if event == "graph"]
        assert len(graphs) >= 2
        assert len(graphs[0]["nodes"]) < len(graphs[-1]["nodes"])

    def test_carries_jsonld_for_semantic_export(self, client: TestClient, query_body: dict) -> None:
        graphs = [data for event, data in stream(client, query_body) if event == "graph"]
        jsonld = graphs[-1]["jsonLD"]
        assert "@context" in jsonld
        assert len(jsonld["@graph"]) == len(graphs[-1]["nodes"])

    def test_respects_the_requested_node_cap(self, client: TestClient, query_body: dict) -> None:
        query_body["retrieval"]["graph"]["max_nodes"] = 3
        graphs = [data for event, data in stream(client, query_body) if event == "graph"]
        for graph in graphs:
            assert len(graph["nodes"]) <= 3


class TestDone:
    def test_reports_usage_and_citations(self, client: TestClient, query_body: dict) -> None:
        done = next(data for event, data in stream(client, query_body) if event == "done")

        assert done["usage"]["output_tokens"] > 0
        assert len(done["citations"]) > 0
        assert all("source" in citation for citation in done["citations"])

    def test_input_tokens_scale_with_conversation_length(
        self, client: TestClient, query_body: dict
    ) -> None:
        # Guards the multi-turn contract from the service side: a longer
        # history has to reach the model, not just the newest message.
        short = next(data for event, data in stream(client, query_body) if event == "done")

        query_body["messages"] = query_body["messages"] * 4
        long = next(data for event, data in stream(client, query_body) if event == "done")

        assert long["usage"]["input_tokens"] > short["usage"]["input_tokens"]


class TestRouting:
    def test_selects_an_answer_from_the_question(
        self, client: TestClient, query_body: dict
    ) -> None:
        query_body["input"]["text"] = "show me inventory levels"
        answer = "".join(
            data["text"] for event, data in stream(client, query_body) if event == "delta"
        )
        assert "Warehouse" in answer

    def test_rejects_a_request_missing_required_fields(self, client: TestClient) -> None:
        assert client.post("/api/query", json={"conversation_id": "c"}).status_code == 422
