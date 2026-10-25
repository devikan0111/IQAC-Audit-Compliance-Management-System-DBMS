// =====================================================================
// IQAC Audit & Compliance Management System
// STEP 3b: MongoDB demo queries (paste the whole file into the Compass
// shell, or run: mongosh "mongodb://localhost:27017" --file 03_mongo_tests.js)
// No "use" command is needed: the script selects the database itself.
// =====================================================================

const iq = db.getSiblingDB("iqac_nosql");

print("\n--- 1. Document counts ---");
print("faculty_evidence    : " + iq.faculty_evidence.countDocuments());
print("department_evidence : " + iq.department_evidence.countDocuments());

print("\n--- 2. Multikey index: all submissions that list Meena Iyer as an author ---");
printjson(iq.faculty_evidence
  .find({ "authors.name": "Meena Iyer" }, { title: 1, submission_type: 1 })
  .toArray());

print("\n--- 3. Text index: similar titles/abstracts (duplicate detection) ---");
printjson(iq.faculty_evidence
  .find({ $text: { $search: "machine learning healthcare diagnosis" } },
        { title: 1, score: { $meta: "textScore" } })
  .sort({ score: { $meta: "textScore" } })
  .toArray());

print("\n--- 4. Filter on a type-specific field (Scopus-indexed papers) ---");
printjson(iq.faculty_evidence
  .find({ submission_type: "research_paper", "details.indexing": "Scopus" },
        { title: 1, "details.journal_name": 1 })
  .toArray());

print("\n--- 5. Department evidence: lab upgrades above 10 lakh ---");
printjson(iq.department_evidence
  .find({ metric_category: "lab_upgrade", "details.cost_inr": { $gt: 1000000 } },
        { summary: 1, "details.lab_name": 1, "details.cost_inr": 1 })
  .toArray());

print("\n--- 6. Validation test: patent missing patent_status (must be REJECTED) ---");
try {
  iq.faculty_evidence.insertOne({
    mysql_submission_id: 99, faculty_id: 5, cycle_id: 1,
    submission_type: "patent", title: "Test patent",
    authors: [{ name: "X" }],
    details: { patent_number: "IN1" },
    created_at: new Date()
  });
  print("PROBLEM: the invalid document was accepted");
} catch (e) {
  print("Rejected as expected: " + e.message);
}

print("\n--- 7. Unique link test: second evidence doc for MySQL submission 1 (must be REJECTED) ---");
try {
  iq.faculty_evidence.insertOne({
    mysql_submission_id: 1, faculty_id: 5, cycle_id: 1,
    submission_type: "patent", title: "Duplicate link test",
    authors: [{ name: "X" }],
    details: { patent_number: "IN2", patent_status: "filed" },
    created_at: new Date()
  });
  print("PROBLEM: the duplicate link was accepted");
} catch (e) {
  print("Rejected as expected: " + e.message);
}
