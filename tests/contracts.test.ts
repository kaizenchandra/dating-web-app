import { test } from "node:test";
import assert from "node:assert/strict";
import contract from "../packages/api-contracts/openapi.v1.json";
test("public readiness contract exposes no account or secret fields", () => {
  const schema =
    contract.paths["/status"].get.responses[200].content["application/json"]
      .schema;
  assert.deepEqual(Object.keys(schema.properties), ["environment", "services"]);
  assert.equal(contract.openapi, "3.1.0");
});
