import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("structured interests rewrite the file, and a hobby is computed rather than stored", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pips-overview-"));
  const previous = process.env.DATA_DIR;
  const previousPublic = process.env.PUBLIC_OVERVIEW;
  process.env.DATA_DIR = dir;
  delete process.env.PUBLIC_OVERVIEW;
  const db = await import("./db.js");
  const interests = await import("./interests.js");
  const memory = await import("./memory.js");
  const overview = await import("./overview.js");
  db.openDatabase();
  try {
    const prose = "# Interests\n\n## Windows\n\nHe wrote this himself.\n";
    memory.writeMemory("interests.md", prose);
    assert.equal(memory.readMemory("interests.md"), prose);
    assert.equal(db.listInterestRecords().length, 0);
    const parsed = interests.interestCards(memory.readMemory("interests.md"));
    assert.equal(parsed[0]?.name, "Windows");
    assert.equal(parsed[0]?.hobby, false);
    assert.equal(parsed[0]?.strength, null);

    const error = interests.saveStructuredInterests([
      {
        name: "Paper boats",
        summary: "How a folded sheet stays up.",
        strength: 4,
        first_seen: "2026-11-01",
        last_active: "2026-11-08",
        hobby: true,
        evidence: { diary: ["d1"], domains: ["example.com"], creations: ["abc"] },
      },
    ]);
    assert.equal(error, null);
    const file = memory.readMemory("interests.md");
    assert.match(file, /## Paper boats/);
    assert.match(file, /Strength 4 of 5\. First seen 2026-11-01\. Last active 2026-11-08\./);
    assert.equal(/hobby/i.test(file), false);
    const cards = interests.interestCards(file);
    assert.equal(cards[0]?.hobby, true);
    assert.equal(cards[0]?.domains[0], "example.com");

    assert.equal(
      interests.isHobby({ strength: 3, firstSeen: "2026-11-01", lastActive: "2026-11-20" }, Date.parse("2026-11-27T00:00:00Z")),
      false,
    );
    assert.equal(
      interests.isHobby({ strength: 5, firstSeen: "2026-11-20", lastActive: "2026-11-21" }, Date.parse("2026-11-27T00:00:00Z")),
      false,
    );

    const exact = "# Interests\n\nStill his own words.\n";
    memory.writeMemory("interests.md", exact);
    assert.equal(memory.readMemory("interests.md"), exact);
    assert.equal(db.listInterestRecords().length, 1);

    memory.writeMemory("identity.md", "Pip, before.\n");
    db.rememberIdentity("Pip, before.\n", "Pip, after.\n");
    const versions = db.listIdentityVersions();
    assert.equal(versions.length, 2);
    assert.match(versions[0]?.body ?? "", /after/);

    assert.equal(overview.publicOverviewEnabled(), false);
    process.env.PUBLIC_OVERVIEW = "1";
    assert.equal(overview.publicOverviewEnabled(), true);
    const facts = db.overviewFacts();
    assert.equal(typeof facts.daysAlive, "number");
    assert.ok(Array.isArray(facts.activity));
  } finally {
    db.closeDatabase();
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    if (previousPublic === undefined) delete process.env.PUBLIC_OVERVIEW;
    else process.env.PUBLIC_OVERVIEW = previousPublic;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
