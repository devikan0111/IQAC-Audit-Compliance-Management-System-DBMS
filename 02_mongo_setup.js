// =====================================================================
// IQAC Audit & Compliance Management System
// STEP 3: MongoDB creation  (run with mongosh)
//
//   mongosh "mongodb://localhost:27017" --file 02_mongo_setup.js
//
// Database : iqac_nosql
// Purpose  : stores the FLEXIBLE evidence details of each submission.
//            MySQL keeps the structured/scoring data; each MySQL row points
//            here through mongo_doc_id, and each Mongo document points back
//            through mysql_submission_id / mysql_dept_metric_id.
// =====================================================================

const dbName = "iqac_nosql";
const iq = db.getSiblingDB(dbName);

// Start clean so the script can be re-run safely
iq.faculty_evidence.drop();
iq.department_evidence.drop();

// ---------------------------------------------------------------------
// Shared sub-schema: list of attached evidence files
// ---------------------------------------------------------------------
const attachmentsSchema = {
  bsonType: "array",
  items: {
    bsonType: "object",
    required: ["file_name", "url"],
    properties: {
      file_name:   { bsonType: "string" },
      url:         { bsonType: "string", pattern: "^http" },
      uploaded_at: { bsonType: "date" }
    }
  }
};

// ---------------------------------------------------------------------
// COLLECTION 1: faculty_evidence
// One document per faculty submission. The shape of "details" changes
// with submission_type, which is exactly why this is NoSQL.
// ---------------------------------------------------------------------
iq.createCollection("faculty_evidence", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["mysql_submission_id", "faculty_id", "cycle_id",
                 "submission_type", "title", "details", "created_at"],
      properties: {
        mysql_submission_id: { bsonType: "number", minimum: 1,
          description: "Faculty_Submissions.submission_id in MySQL" },
        faculty_id:          { bsonType: "number", minimum: 1 },
        cycle_id:            { bsonType: "number", minimum: 1 },
        submission_type: {
          enum: ["research_paper", "patent", "workshop",
                 "fdp", "book_chapter", "mentorship"]
        },
        title:    { bsonType: "string", minLength: 3 },
        abstract: { bsonType: "string" },
        keywords: { bsonType: "array", items: { bsonType: "string" } },
        authors: {                       // multi-valued attribute lives here
          bsonType: "array",
          minItems: 1,
          items: {
            bsonType: "object",
            required: ["name"],
            properties: {
              name:        { bsonType: "string" },
              affiliation: { bsonType: "string" },
              is_internal: { bsonType: "bool" }
            }
          }
        },
        attachments: attachmentsSchema,
        details:     { bsonType: "object" },
        created_at:  { bsonType: "date" },
        updated_at:  { bsonType: "date" }
      },
      // "details" must match the schema of its own submission_type
      oneOf: [
        { properties: { submission_type: { enum: ["research_paper"] },
            details: { bsonType: "object",
              required: ["journal_name", "publication_year", "indexing"],
              properties: {
                journal_name:     { bsonType: "string" },
                publication_year: { bsonType: "number", minimum: 1990, maximum: 2100 },
                indexing:         { enum: ["Scopus", "WoS", "UGC-CARE", "Other"] },
                impact_factor:    { bsonType: "number", minimum: 0 },
                doi:              { bsonType: "string" }
              } } } },
        { properties: { submission_type: { enum: ["patent"] },
            details: { bsonType: "object",
              required: ["patent_number", "patent_status"],
              properties: {
                patent_number:  { bsonType: "string" },
                patent_status:  { enum: ["filed", "published", "granted"] },
                filing_date:    { bsonType: "date" },
                country:        { bsonType: "string" }
              } } } },
        { properties: { submission_type: { enum: ["workshop"] },
            details: { bsonType: "object",
              required: ["role", "duration_days"],
              properties: {
                role:            { enum: ["attendee", "resource_person", "organizer"] },
                duration_days:   { bsonType: "number", minimum: 1 },
                attendee_count:  { bsonType: "number", minimum: 0 },
                certificate_url: { bsonType: "string" }
              } } } },
        { properties: { submission_type: { enum: ["fdp"] },
            details: { bsonType: "object",
              required: ["program_name", "duration_days", "mode"],
              properties: {
                program_name:  { bsonType: "string" },
                organizer:     { bsonType: "string" },
                duration_days: { bsonType: "number", minimum: 1 },
                mode:          { enum: ["online", "offline", "hybrid"] }
              } } } },
        { properties: { submission_type: { enum: ["book_chapter"] },
            details: { bsonType: "object",
              required: ["book_title", "publisher"],
              properties: {
                book_title: { bsonType: "string" },
                publisher:  { bsonType: "string" },
                isbn:       { bsonType: "string" }
              } } } },
        { properties: { submission_type: { enum: ["mentorship"] },
            details: { bsonType: "object",
              required: ["program_name", "mentee_count"],
              properties: {
                program_name: { bsonType: "string" },
                mentee_count: { bsonType: "number", minimum: 1 },
                period:       { bsonType: "string" }
              } } } }
      ]
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

// ---------------------------------------------------------------------
// COLLECTION 2: department_evidence
// One document per department metric entered by an HOD.
// ---------------------------------------------------------------------
iq.createCollection("department_evidence", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["mysql_dept_metric_id", "dept_id", "cycle_id",
                 "metric_category", "details", "created_at"],
      properties: {
        mysql_dept_metric_id: { bsonType: "number", minimum: 1,
          description: "Department_Metrics.dept_metric_id in MySQL" },
        dept_id:   { bsonType: "number", minimum: 1 },
        cycle_id:  { bsonType: "number", minimum: 1 },
        metric_category: {
          enum: ["placement", "budget", "lab_upgrade", "infrastructure"]
        },
        summary:     { bsonType: "string" },
        details:     { bsonType: "object" },
        attachments: attachmentsSchema,
        created_at:  { bsonType: "date" },
        updated_at:  { bsonType: "date" }
      },
      oneOf: [
        { properties: { metric_category: { enum: ["placement"] },
            details: { bsonType: "object",
              required: ["students_placed", "total_eligible"],
              properties: {
                students_placed: { bsonType: "number", minimum: 0 },
                total_eligible:  { bsonType: "number", minimum: 1 },
                highest_package_lpa: { bsonType: "number", minimum: 0 },
                average_package_lpa: { bsonType: "number", minimum: 0 },
                top_recruiters:  { bsonType: "array", items: { bsonType: "string" } }
              } } } },
        { properties: { metric_category: { enum: ["budget"] },
            details: { bsonType: "object",
              required: ["allocated_inr", "spent_inr"],
              properties: {
                allocated_inr: { bsonType: "number", minimum: 0 },
                spent_inr:     { bsonType: "number", minimum: 0 },
                heads: { bsonType: "array",
                  items: { bsonType: "object",
                    required: ["head", "amount_inr"],
                    properties: { head: { bsonType: "string" },
                                  amount_inr: { bsonType: "number", minimum: 0 } } } }
              } } } },
        { properties: { metric_category: { enum: ["lab_upgrade"] },
            details: { bsonType: "object",
              required: ["lab_name", "cost_inr"],
              properties: {
                lab_name: { bsonType: "string" },
                cost_inr: { bsonType: "number", minimum: 0 },
                vendor:   { bsonType: "string" },
                equipment: { bsonType: "array",
                  items: { bsonType: "object",
                    required: ["item", "quantity"],
                    properties: { item: { bsonType: "string" },
                                  quantity: { bsonType: "number", minimum: 1 } } } }
              } } } },
        { properties: { metric_category: { enum: ["infrastructure"] },
            details: { bsonType: "object",
              required: ["facility", "area_sqft"],
              properties: {
                facility:  { bsonType: "string" },
                area_sqft: { bsonType: "number", minimum: 1 },
                capacity:  { bsonType: "number", minimum: 0 }
              } } } }
      ]
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

// ---------------------------------------------------------------------
// INDEXES
// ---------------------------------------------------------------------
// 1:1 link back to MySQL, so a MySQL row can never have two evidence docs
iq.faculty_evidence.createIndex({ mysql_submission_id: 1 },
                                { unique: true, name: "uq_mysql_submission" });
// dashboard filter: "all papers in cycle 1"
iq.faculty_evidence.createIndex({ cycle_id: 1, submission_type: 1 },
                                { name: "idx_cycle_type" });
// "show everything faculty X uploaded"
iq.faculty_evidence.createIndex({ faculty_id: 1 }, { name: "idx_faculty" });
// multikey index on the authors array (co-author / duplicate-claim lookup)
iq.faculty_evidence.createIndex({ "authors.name": 1 }, { name: "idx_author_name" });
// text index: semantic-ish search over titles, abstracts and keywords
iq.faculty_evidence.createIndex(
  { title: "text", abstract: "text", keywords: "text" },
  { name: "txt_title_abstract_keywords",
    weights: { title: 5, keywords: 3, abstract: 1 } });

iq.department_evidence.createIndex({ mysql_dept_metric_id: 1 },
                                   { unique: true, name: "uq_mysql_dept_metric" });
iq.department_evidence.createIndex({ cycle_id: 1, dept_id: 1, metric_category: 1 },
                                   { name: "idx_cycle_dept_category" });

// ---------------------------------------------------------------------
// SEED DATA
// The ObjectIds below are FIXED so the MySQL seed script (Step 4) can store
// the same values in Faculty_Submissions.mongo_doc_id /
// Department_Metrics.mongo_doc_id.
// Assumed MySQL ids: users 5,6 = Faculty CSE, 7 = Faculty ECE;
//                    dept 1 = CSE, 2 = ECE; cycle 1 = AQAR 2025-26.
// ---------------------------------------------------------------------
iq.faculty_evidence.insertMany([
  { _id: ObjectId("65a000000000000000000001"),
    mysql_submission_id: 1, faculty_id: 5, cycle_id: 1,
    submission_type: "research_paper",
    title: "AI in Healthcare: A Survey of Diagnostic Models",
    abstract: "A survey of deep learning approaches used for medical image diagnosis and clinical decision support.",
    keywords: ["artificial intelligence", "healthcare", "deep learning", "diagnosis"],
    authors: [ { name: "Ravi Kumar",  affiliation: "PES University", is_internal: true },
               { name: "Meena Iyer",  affiliation: "PES University", is_internal: true },
               { name: "John Smith",  affiliation: "MIT",            is_internal: false } ],
    attachments: [ { file_name: "ai_healthcare.pdf",
                     url: "https://drive.example.edu/ai_healthcare.pdf",
                     uploaded_at: ISODate("2026-01-10T09:30:00Z") } ],
    details: { journal_name: "IEEE Access", publication_year: 2025,
               indexing: "Scopus", impact_factor: 3.9, doi: "10.1109/ACCESS.2025.1001" },
    created_at: ISODate("2026-01-10T09:30:00Z") },

  { _id: ObjectId("65a000000000000000000002"),
    mysql_submission_id: 2, faculty_id: 6, cycle_id: 1,
    submission_type: "research_paper",
    title: "Machine Learning Applications in Medical Diagnostics",
    abstract: "Reviews machine learning methods for detecting disease from clinical imaging data.",
    keywords: ["machine learning", "medical", "diagnostics"],
    authors: [ { name: "Meena Iyer", affiliation: "PES University", is_internal: true } ],
    attachments: [ { file_name: "ml_med_diag.pdf",
                     url: "https://drive.example.edu/ml_med_diag.pdf",
                     uploaded_at: ISODate("2026-01-12T11:00:00Z") } ],
    details: { journal_name: "Springer Health Informatics", publication_year: 2025,
               indexing: "WoS", impact_factor: 2.4, doi: "10.1007/hi.2025.2002" },
    created_at: ISODate("2026-01-12T11:00:00Z") },

  { _id: ObjectId("65a000000000000000000003"),
    mysql_submission_id: 3, faculty_id: 5, cycle_id: 1,
    submission_type: "patent",
    title: "Low-Cost IoT Device for Soil Moisture Monitoring",
    keywords: ["iot", "agriculture", "sensor"],
    authors: [ { name: "Ravi Kumar", affiliation: "PES University", is_internal: true } ],
    attachments: [ { file_name: "patent_filing.pdf",
                     url: "https://drive.example.edu/patent_filing.pdf",
                     uploaded_at: ISODate("2026-02-02T10:00:00Z") } ],
    details: { patent_number: "IN202641012345", patent_status: "published",
               filing_date: ISODate("2025-11-20T00:00:00Z"), country: "India" },
    created_at: ISODate("2026-02-02T10:00:00Z") },

  { _id: ObjectId("65a000000000000000000004"),
    mysql_submission_id: 4, faculty_id: 7, cycle_id: 1,
    submission_type: "workshop",
    title: "Hands-on Workshop on Embedded Systems Design",
    keywords: ["embedded", "workshop"],
    authors: [ { name: "Priya Nair", affiliation: "PES University", is_internal: true } ],
    attachments: [ { file_name: "workshop_certificate.pdf",
                     url: "https://drive.example.edu/workshop_certificate.pdf",
                     uploaded_at: ISODate("2026-02-15T14:00:00Z") } ],
    details: { role: "resource_person", duration_days: 3, attendee_count: 85,
               certificate_url: "https://drive.example.edu/workshop_certificate.pdf" },
    created_at: ISODate("2026-02-15T14:00:00Z") },

  { _id: ObjectId("65a000000000000000000005"),
    mysql_submission_id: 5, faculty_id: 6, cycle_id: 1,
    submission_type: "fdp",
    title: "FDP on Cloud Computing and DevOps",
    keywords: ["fdp", "cloud", "devops"],
    authors: [ { name: "Meena Iyer", affiliation: "PES University", is_internal: true } ],
    attachments: [],
    details: { program_name: "Cloud Computing and DevOps", organizer: "IIT Madras",
               duration_days: 5, mode: "hybrid" },
    created_at: ISODate("2026-03-01T09:00:00Z") },

  { _id: ObjectId("65a000000000000000000006"),
    mysql_submission_id: 6, faculty_id: 7, cycle_id: 1,
    submission_type: "mentorship",
    title: "Student Mentorship Programme 2025-26",
    keywords: ["mentorship", "students"],
    authors: [ { name: "Priya Nair", affiliation: "PES University", is_internal: true } ],
    attachments: [],
    details: { program_name: "Mentor-Mentee Scheme", mentee_count: 20, period: "Aug 2025 - Apr 2026" },
    created_at: ISODate("2026-03-10T09:00:00Z") }
]);

iq.department_evidence.insertMany([
  { _id: ObjectId("65b000000000000000000001"),
    mysql_dept_metric_id: 1, dept_id: 1, cycle_id: 1,
    metric_category: "placement",
    summary: "CSE campus placements 2025-26",
    details: { students_placed: 106, total_eligible: 120,
               highest_package_lpa: 42, average_package_lpa: 11.5,
               top_recruiters: ["Google", "Microsoft", "Infosys", "Bosch"] },
    attachments: [ { file_name: "offer_letters.pdf",
                     url: "https://drive.example.edu/cse_offers.pdf" } ],
    created_at: ISODate("2026-04-05T10:00:00Z") },

  { _id: ObjectId("65b000000000000000000002"),
    mysql_dept_metric_id: 2, dept_id: 1, cycle_id: 1,
    metric_category: "lab_upgrade",
    summary: "AI/ML lab upgrade",
    details: { lab_name: "AI & ML Lab", cost_inr: 1850000, vendor: "Dell Technologies",
               equipment: [ { item: "GPU Workstation", quantity: 10 },
                            { item: "Network Switch",  quantity: 2 } ] },
    attachments: [ { file_name: "vendor_invoice.pdf",
                     url: "https://drive.example.edu/cse_lab_invoice.pdf" } ],
    created_at: ISODate("2026-04-08T10:00:00Z") },

  { _id: ObjectId("65b000000000000000000003"),
    mysql_dept_metric_id: 3, dept_id: 2, cycle_id: 1,
    metric_category: "budget",
    summary: "ECE annual budget utilisation",
    details: { allocated_inr: 4000000, spent_inr: 3650000,
               heads: [ { head: "Equipment",  amount_inr: 2200000 },
                        { head: "Workshops",  amount_inr: 650000 },
                        { head: "Consumables", amount_inr: 800000 } ] },
    attachments: [ { file_name: "budget_approval.pdf",
                     url: "https://drive.example.edu/ece_budget.pdf" } ],
    created_at: ISODate("2026-04-10T10:00:00Z") }
]);

// ---------------------------------------------------------------------
// QUICK VERIFICATION
// ---------------------------------------------------------------------
print("Collections : " + iq.getCollectionNames().join(", "));
print("faculty_evidence    docs: " + iq.faculty_evidence.countDocuments());
print("department_evidence docs: " + iq.department_evidence.countDocuments());
print("Indexes (faculty_evidence): " +
      iq.faculty_evidence.getIndexes().map(i => i.name).join(", "));
