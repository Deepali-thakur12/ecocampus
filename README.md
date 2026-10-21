# EcoCampus

EcoCampus is an Oracle Database and PL/SQL project for campus refills, student
wallets, purchases, inventory, transfers, and sustainability rewards. This
project includes the Oracle database layer and a responsive browser dashboard
that can run as a browser-only demo or connect to Oracle through the local
Node.js API.

## Requirements

- Oracle Database 12c or newer (identity columns are used)
- VS Code with Oracle Developer Tools for VS Code, or Oracle SQL Developer
- A database user allowed to create tables, indexes, triggers, procedures, and functions

## Project files

- `database/install.sql` — installs all scripts in order
- `database/schema.sql` — tables, constraints, indexes, and wallet audit trigger
- `database/routines.sql` — discount function, wallet creation, purchase,
  transfer, and explicit-cursor low-stock report
- `database/seed.sql` — repeatable sample students, wallets, and products
- `frontend/index.html` — responsive student dashboard
- `frontend/styles.css` — dashboard styles and responsive layouts
- `frontend/app.js` — dashboard rendering, demo shopping, and Oracle API integration

## Run the dashboard

Open `frontend/index.html` in a browser, or open it in VS Code and use the
Live Server extension. The demo includes sample students, products, purchases,
wallet transfers, stock alerts, discount estimates, and refill impact stats.
Changes are stored in that browser's local storage. Use the reset icon in the
top bar to restore the original sample data. For refill rewards, check “I
brought my reusable container” before purchasing; the dashboard only counts
estimated containers avoided when this is selected.

## Connect the dashboard to Oracle

The Node.js API connects the browser dashboard to the Oracle schema and invokes
`REGISTER_STUDENT_ACCOUNT`, `PROCESS_PURCHASE`, and `TRANSFER_FUNDS`. Use
**Add account** on the dashboard to create a student and opening wallet. Each
account needs a name, unique email, department, and opening balance of at least
INR 100. The Overview account selector lets you switch between accounts.
Wallet balances, inventory, activity, discounts, sustainability totals, and
audit records are read or updated in Oracle when Oracle mode is active.

1. Install the database schema and PL/SQL objects with `database/install.sql`.
   Create or use a **test schema** for this project.
2. Install Node.js 18 or newer.
3. In the project root, run `npm install`.
4. Copy `.env.example` to `.env`. Set `ORACLE_USER`, `ORACLE_PASSWORD`, and
   `ORACLE_CONNECT_STRING` to the credentials and connect string for the schema
   where you installed the database objects.
5. Start the API with `npm start`, then open `http://127.0.0.1:3000`.
6. The dashboard should show **ORACLE LIVE**. If it shows **ORACLE OFFLINE**,
   read the server terminal and verify the credentials, listener, service name,
   and schema installation.

`oracledb` uses its Thin mode by default, so a separate Oracle Instant Client is
not required for supported Oracle Database versions. Do not commit `.env` or
put database credentials in browser JavaScript.

**Security limitation:** This project is configured for local coursework and
binds only to `127.0.0.1`, but it has no student login or authorization. Anyone
who can access the local API can select a sample student and request a
purchase or transfer. Use only a disposable test database; do not expose this
server to a campus network or use it for real student wallets. A real
deployment needs authenticated users, server-side authorization for each
wallet, HTTPS, and operational safeguards.

## Install

1. Connect to your Oracle database in Oracle Developer Tools or SQL Developer.
2. Open `database/install.sql`.
3. Run it as a script (F5 in SQL Developer), not as a single statement.
4. Check the script output for `EcoCampus installation complete.`

The scripts create objects in the connected user's schema. The setup script is
for a fresh schema; it does not drop existing tables or replace an existing
installation.

## Run the examples

Enable DBMS Output in your SQL client to see the low-stock report. Run these
examples after installation; use `ROLLBACK` instead of `COMMIT` if you only want
to inspect a transaction's effects.

```sql
-- Minimum-opening-balance validation (this example rolls back its test student)
DECLARE
    v_student_id students.student_id%TYPE;
    v_wallet_id wallet_accounts.wallet_id%TYPE;
BEGIN
    INSERT INTO students (full_name, email, department)
    VALUES ('Test Student', 'wallet.test@ecocampus.edu', 'Testing')
    RETURNING student_id INTO v_student_id;

    create_wallet_account(v_student_id, 500, v_wallet_id);
    DBMS_OUTPUT.PUT_LINE('Created wallet ' || v_wallet_id);
    ROLLBACK;
END;
/

-- User-defined discount function: expected result is 12
SELECT calculate_purchase_discount(1000, 'Y') AS discount_percent FROM dual;

-- Explicit cursor report: products with stock below 10
BEGIN
    report_low_stock(10);
END;
/

-- A refill purchase with a reusable container
DECLARE
    v_order_id orders.order_id%TYPE;
    v_student_id students.student_id%TYPE;
    v_product_id products.product_id%TYPE;
BEGIN
    SELECT student_id INTO v_student_id
    FROM students
    WHERE email = 'aarav.sharma@ecocampus.edu';

    SELECT product_id INTO v_product_id
    FROM products
    WHERE product_name = 'Filtered Water Refill';

    process_purchase(v_student_id, v_product_id, 2, 'Y', v_order_id);
    DBMS_OUTPUT.PUT_LINE('Created order ' || v_order_id);
    COMMIT;
END;
/

-- Transfer INR 100 between the first two sample wallets
DECLARE
    v_sender_id wallet_accounts.wallet_id%TYPE;
    v_receiver_id wallet_accounts.wallet_id%TYPE;
    v_transfer_id fund_transfers.transfer_id%TYPE;
BEGIN
    SELECT MIN(wallet_id), MAX(wallet_id)
    INTO v_sender_id, v_receiver_id
    FROM wallet_accounts;

    transfer_funds(v_sender_id, v_receiver_id, 100, v_transfer_id);
    DBMS_OUTPUT.PUT_LINE('Created transfer ' || v_transfer_id);
    COMMIT;
END;
/
```

The purchase and transfer procedures use savepoints and roll back their own
partial work on error, then re-raise the error. They do not commit: the caller
controls the transaction. Successful wallet balance updates automatically
write old balance, new balance, delta, wallet ID, and timestamp to
`BALANCE_AUDIT`.

## Business rules and assumptions

- A wallet is unique per student. Its opening balance must be at least INR 100;
  after opening, purchases and transfers may reduce it to zero but never below.
- New student accounts are added with a unique email and an opening wallet
  balance of at least INR 100.
- Purchase discounts are 5% for subtotals of at least INR 500, 10% for at
  least INR 1,000, plus 2 percentage points for using a reusable container on
  a refillable product, capped at 12%.
- Wallet amounts and transfers use INR precision to two decimal places.
- A purchase is one product per order. Stock and wallet rows are locked while
  a purchase or transfer is processed.
- Refill purchases are logged. The estimate assumes one disposable container
  avoided per refill unit only when the reusable-container flag is `Y`; this is
  an estimate, not a measured environmental impact.
- Failed purchases and transfers raise descriptive Oracle application errors
  and do not create records. Invalid product, student, and wallet IDs are
  reported explicitly.

## Useful checks

```sql
SELECT * FROM wallet_accounts ORDER BY wallet_id;
SELECT * FROM orders ORDER BY ordered_at DESC;
SELECT * FROM fund_transfers ORDER BY transferred_at DESC;
SELECT * FROM balance_audit ORDER BY changed_at DESC;
SELECT * FROM sustainability_log ORDER BY recorded_at DESC;
```
