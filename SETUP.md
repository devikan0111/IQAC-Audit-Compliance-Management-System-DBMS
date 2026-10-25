# Local IQAC setup

Requirements: Node.js 22+, npm and a running MySQL 8 server. Run commands from this project folder.

1. Run npm ci.
2. Copy .env.example to .env.local if that private file does not already exist. Fill in MYSQL_SETUP_PASSWORD for your local MySQL root account. Keep the app account separate from root. For a new app account, leave MYSQL_PASSWORD blank; bootstrap generates and saves a password privately.
3. Run npm run db:bootstrap. It creates the project schema when absent, seeds empty core tables, installs portal/scoring routines and configures restricted app grants. It refuses a partial existing schema. Do not manually rerun 01_schema.sql on data you need: that original script drops iqac_db.
4. Run npm run build.
5. Run npm run demo and leave the terminal open. Open http://localhost:3000.

The demo launcher reuses local MongoDB or downloads the official MongoDB runtime into .runtime and starts it on 127.0.0.1:27017. Local data stays in .data. First download needs internet. Compass is optional; connect it to mongodb://127.0.0.1:27017. Closing the demo stops only a MongoDB server that the launcher itself started.

After source changes, stop the demo with Ctrl+C, rebuild and start it again. Restart after .env.local changes too. Never share .env.local, .data or runtime credentials.

## Demo accounts

All seeded accounts initially use Pass@123:

- ravi.kumar@pes.edu — Faculty, CSE
- hod.cse@pes.edu — HOD, CSE
- auditor@pes.edu — Auditor
- principal@pes.edu — Admin

Use these public credentials only for the local academic demo. See DEMO_VIVA.md for the presentation sequence, reports and viva questions.

## Verification commands

- npm test: local automated checks.
- npm run test:sql: creates and cleans a disposable SQL QA schema/account; requires setup credentials.
- npm run test:demo: creates and cleans disposable SQL/Mongo QA databases and a test server on port 3001. Requires setup credentials and local MongoDB. Keep port 3001 free.
- npm run test:integration: targets the configured running app directly and changes records; prefer test:demo for routine verification.

The app uses MySQL for authoritative workflow/permissions and MongoDB for evidence documents. A durable MySQL outbox retries evidence delivery; this is not a distributed atomic transaction. Evidence attachments are URL references. The local demonstration is not a production deployment.
