"""A console that relays whatever it is handed is a write endpoint.

openCypher has CREATE, MERGE, DELETE, SET and REMOVE; SPARQL has UPDATE and
DROP. Read-only has to mean it, and these are the phrasings it has to survive.

Two mechanisms are under test and they do different jobs. The guard produces a
legible refusal; the driver's READ access mode is the guarantee. The guard being
wrong costs a confusing message. The driver being absent costs the graph.
"""

import pytest

from app.retrieval.query_guard import QueryRejected, check


class TestWhatIsRefused:
    @pytest.mark.parametrize(
        "query",
        [
            "MATCH (n) DELETE n",
            "MATCH (n) DETACH DELETE n",
            "CREATE (n:Thing) RETURN n",
            "MERGE (n:Thing {id: 1}) RETURN n",
            "MATCH (n) SET n.x = 1 RETURN n",
            "MATCH (n) REMOVE n.x RETURN n",
            "DROP INDEX something",
            "MATCH (n) FOREACH (x IN [1] | SET n.y = x)",
            "LOAD CSV FROM 'file:///etc/passwd' AS row RETURN row",
        ],
    )
    def test_refuses_every_way_of_writing(self, query: str):
        with pytest.raises(QueryRejected):
            check(query)

    @pytest.mark.parametrize(
        "query",
        ["INSERT DATA { <a> <b> <c> }", "CLEAR GRAPH <g>", "DROP GRAPH <g>"],
    )
    def test_refuses_sparql_update_too(self, query: str):
        # The SPARQL adapter is not here yet. A guard that only learns a language
        # after that language can already write is a guard that arrives late.
        with pytest.raises(QueryRejected):
            check(query)

    @pytest.mark.parametrize(
        "query",
        [
            "CALL apoc.load.json('http://169.254.169.254/latest/meta-data/')",
            "CALL dbms.listConfig()",
            "CALL db.index.fulltext.createNodeIndex('x', ['A'], ['b'])",
        ],
    )
    def test_refuses_procedures_that_write_or_reach_outside(self, query: str):
        # apoc.load fetches a URL, which is the SSRF the rest of this service
        # takes care to prevent; dbms.* reaches administration.
        with pytest.raises(QueryRejected):
            check(query)

    def test_refuses_anything_it_does_not_recognise_as_a_read(self):
        # Conservative on purpose: the cost of refusing an unfamiliar read is a
        # rephrasing, and the cost of allowing an unfamiliar write is the graph.
        with pytest.raises(QueryRejected):
            check("SHOW DATABASES")

    def test_refuses_an_empty_query(self):
        with pytest.raises(QueryRejected):
            check("   ")

    def test_says_what_was_wrong(self):
        with pytest.raises(QueryRejected) as raised:
            check("MATCH (n) DELETE n")

        assert "DELETE" in raised.value.reason
        assert "read-only" in raised.value.reason


class TestWhatIsAllowed:
    @pytest.mark.parametrize(
        "query",
        [
            "MATCH (n) RETURN n LIMIT 5",
            "MATCH (a)-[r]->(b) RETURN labels(a)[0], type(r) ORDER BY 1",
            "WITH 1 AS x RETURN x",
            "UNWIND [1,2,3] AS n RETURN n",
            "EXPLAIN MATCH (n) RETURN n",
            "PROFILE MATCH (n) RETURN count(n)",
        ],
    )
    def test_allows_ordinary_reads(self, query: str):
        check(query)

    def test_a_keyword_inside_a_string_is_not_a_clause(self):
        # A node genuinely called "DELETE ME" is a read, and refusing it would
        # be the guard mistaking text for an instruction.
        check("MATCH (n {name: 'DELETE ME'}) RETURN n")

    def test_a_keyword_inside_a_comment_is_not_a_clause(self):
        check("// we used to CREATE these\nMATCH (n) RETURN n")

    def test_a_word_containing_a_clause_is_not_a_clause(self):
        # `Created` contains CREATE; matching on word boundaries is what stops
        # a label from being read as an instruction.
        check("MATCH (n:CreatedThing) RETURN n.setting")


class TestTheEndpoint:
    def test_a_backend_with_no_query_language_says_so(self, client):
        # Fixtures serve a bundled graph rather than a database. Silence here
        # would read as the query failing.
        response = client.post(
            "/api/graph/query", json={"query": "MATCH (n) RETURN n", "backend": "fixtures"}
        )

        assert response.status_code == 400
        assert "no query language" in response.json()["detail"]

    def test_an_unknown_backend_fails_before_anything_runs(self, client):
        response = client.post(
            "/api/graph/query", json={"query": "MATCH (n) RETURN n", "backend": "nonesuch"}
        )

        assert response.status_code == 400


class TestAgainstARealStore:
    """The guard is one half; READ access mode is the other.

    Only a database can be asked whether it honours the access mode, so these
    build the store directly rather than reaching it through the app — the test
    client deliberately has no store credentials, so a test routed through it
    would skip forever and prove nothing.
    """

    @pytest.mark.anyio
    async def test_a_read_returns_rows(self, cypher_store):
        columns, rows = await cypher_store.run_readonly(
            "MATCH (n) RETURN labels(n)[0] AS type LIMIT 3"
        )

        assert columns == ["type"]
        assert rows

    @pytest.mark.anyio
    async def test_the_row_cap_is_applied_here_not_trusted_to_the_query(self, cypher_store):
        # A console is exactly where somebody forgets the LIMIT.
        _, rows = await cypher_store.run_readonly("UNWIND range(1, 5000) AS n RETURN n", limit=10)

        assert len(rows) == 10

    @pytest.mark.anyio
    async def test_the_database_refuses_a_write_even_with_the_guard_bypassed(self, cypher_store):
        """The guarantee, as opposed to the explanation.

        `query_guard` is a set of patterns over a query language, which is a
        guess — and a guess is not an access control. This asks the database
        directly, so a future change that loosened the guard would still not be
        able to write.
        """
        import neo4j

        async with cypher_store._driver.session(default_access_mode="READ") as session:
            with pytest.raises(neo4j.exceptions.ClientError) as raised:
                result = await session.run("CREATE (n:GuardBypassCheck) RETURN n")
                await result.consume()

        assert "AccessMode" in str(raised.value)

    @pytest.mark.anyio
    async def test_nothing_was_written_by_any_of_this(self, cypher_store):
        _, rows = await cypher_store.run_readonly("MATCH (n:GuardBypassCheck) RETURN count(n) AS n")

        assert rows[0]["n"] == 0
