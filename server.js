"use strict";

require("dotenv").config();

const path = require("node:path");
const express = require("express");
const oracledb = require("oracledb");

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const app = express();
const port = Number(process.env.PORT || 3000);
const frontendDirectory = path.join(__dirname, "frontend");
const categoryEmojis = {
  REFILL: "💧",
  DRINKWARE: "🥤",
  PERSONAL_CARE: "🪥",
  STATIONERY: "📓"
};

let pool;

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(frontendDirectory, { index: "index.html" }));

function sendError(res, error) {
  if (error && Number.isInteger(error.errorNum) && error.errorNum >= 20000) {
    return res.status(400).json({ error: error.message });
  }

  console.error("EcoCampus API error:", error);
  return res.status(500).json({
    error: "The database request failed. Check the server terminal and Oracle connection."
  });
}

function requireDatabase(req, res, next) {
  if (!pool) {
    return res.status(503).json({
      ok: false,
      database: false,
      error: "Oracle is not connected. Check the server configuration and Oracle listener."
    });
  }
  return next();
}

function requirePositiveInteger(value, label) {
  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue) || numericValue <= 0) {
    const error = new Error(`${label} must be a positive whole number.`);
    error.errorNum = 20020;
    throw error;
  }
  return numericValue;
}

function requirePositiveMoney(value, label) {
  const numericValue = Number(value);
  if (
    !Number.isFinite(numericValue) ||
    numericValue <= 0 ||
    Math.abs(numericValue * 100 - Math.round(numericValue * 100)) >= 0.000001
  ) {
    const error = new Error(`${label} must be positive and have no more than two decimal places.`);
    error.errorNum = 20021;
    throw error;
  }
  return numericValue;
}

function toTimestamp(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

app.get("/api/health", (req, res) => {
  res.status(pool ? 200 : 503).json({ ok: Boolean(pool), database: Boolean(pool) });
});

app.get("/api/dashboard", requireDatabase, async (req, res) => {
  let connection;
  try {
    const studentId = requirePositiveInteger(req.query.studentId, "Student ID");
    connection = await pool.getConnection();

    const studentsResult = await connection.execute(
      `SELECT s.student_id AS "id",
              s.full_name AS "name",
              w.balance AS "balance",
              w.wallet_id AS "walletId"
       FROM students s
       JOIN wallet_accounts w ON w.student_id = s.student_id
       ORDER BY s.student_id`
    );
    const selectedStudent = studentsResult.rows.find((student) => student.id === studentId);
    if (!selectedStudent) {
      return res.status(404).json({ error: "Student wallet was not found." });
    }

    const productsResult = await connection.execute(
      `SELECT product_id AS "id",
              product_name AS "name",
              category AS "category",
              unit_price AS "price",
              stock_quantity AS "stock",
              is_refillable AS "refillable"
       FROM products
       WHERE is_active = 'Y'
       ORDER BY product_id`
    );

    const statsResult = await connection.execute(
      `SELECT COUNT(CASE
                  WHEN p.is_refillable = 'Y'
                   AND o.ordered_at >= TRUNC(SYSDATE, 'MM')
                  THEN 1
                END) AS "refillCount",
              NVL(SUM(CASE
                    WHEN o.ordered_at >= TRUNC(SYSDATE, 'MM')
                    THEN NVL(sl.containers_avoided, 0)
                    ELSE 0
                  END), 0) AS "containersAvoided",
              NVL(SUM(CASE
                    WHEN o.ordered_at >= TRUNC(SYSDATE, 'MM')
                    THEN o.discount_amount
                    ELSE 0
                  END), 0) AS "discountSavings"
       FROM orders o
       JOIN products p ON p.product_id = o.product_id
       LEFT JOIN sustainability_log sl ON sl.order_id = o.order_id
       WHERE o.student_id = :studentId`,
      { studentId }
    );

    const purchasesResult = await connection.execute(
      `SELECT o.order_id AS "id",
              o.product_name AS "title",
              o.total_amount AS "amount",
              o.ordered_at AS "at",
              o.discount_amount AS "discount",
              p.is_refillable AS "refillable",
              o.reusable_container_used AS "reusableUsed",
              NVL(sl.containers_avoided, 0) AS "containersAvoided"
       FROM orders o
       JOIN products p ON p.product_id = o.product_id
       LEFT JOIN sustainability_log sl ON sl.order_id = o.order_id
       WHERE o.student_id = :studentId
       ORDER BY o.ordered_at DESC
       FETCH FIRST 10 ROWS ONLY`,
      { studentId }
    );

    const transfersResult = await connection.execute(
      `SELECT ft.transfer_id AS "id",
              ft.amount AS "amount",
              ft.transferred_at AS "at",
              sender.student_id AS "senderStudentId",
              sender.full_name AS "senderName",
              receiver.student_id AS "receiverStudentId",
              receiver.full_name AS "receiverName"
       FROM fund_transfers ft
       JOIN wallet_accounts sender_wallet
         ON sender_wallet.wallet_id = ft.sender_wallet_id
       JOIN students sender ON sender.student_id = sender_wallet.student_id
       JOIN wallet_accounts receiver_wallet
         ON receiver_wallet.wallet_id = ft.receiver_wallet_id
       JOIN students receiver ON receiver.student_id = receiver_wallet.student_id
       WHERE sender.student_id = :studentId
          OR receiver.student_id = :studentId
       ORDER BY ft.transferred_at DESC
       FETCH FIRST 10 ROWS ONLY`,
      { studentId }
    );

    const products = productsResult.rows.map((product) => ({
      ...product,
      refillable: product.refillable === "Y",
      emoji: categoryEmojis[product.category] || "♻"
    }));
    const activity = [
      ...purchasesResult.rows.map((purchase) => {
        const reusableUsed = purchase.reusableUsed === "Y";
        return {
          studentId,
          kind: "purchase",
          title: purchase.title,
          detail: reusableUsed && purchase.refillable === "Y"
            ? "Refill with reusable container"
            : (purchase.refillable === "Y" ? "Refill station" : "Campus essentials"),
          amount: -Number(purchase.amount),
          at: toTimestamp(purchase.at),
          refill: purchase.refillable === "Y",
          containers: Number(purchase.containersAvoided),
          discount: Number(purchase.discount)
        };
      }),
      ...transfersResult.rows.map((transfer) => {
        const outgoing = transfer.senderStudentId === studentId;
        return {
          studentId,
          kind: outgoing ? "transfer-out" : "transfer-in",
          title: outgoing
            ? `Transfer to ${transfer.receiverName}`
            : `Transfer from ${transfer.senderName}`,
          detail: "Wallet transfer",
          amount: (outgoing ? -1 : 1) * Number(transfer.amount),
          at: toTimestamp(transfer.at),
          refill: false,
          containers: 0,
          discount: 0
        };
      })
    ].sort((left, right) => right.at - left.at).slice(0, 10);

    return res.json({
      students: studentsResult.rows.map(({ id, name, balance }) => ({
        id,
        name,
        balance: Number(balance)
      })),
      products,
      activity,
      stats: {
        refillCount: Number(statsResult.rows[0].refillCount),
        containersAvoided: Number(statsResult.rows[0].containersAvoided),
        discountSavings: Number(statsResult.rows[0].discountSavings)
      }
    });
  } catch (error) {
    return sendError(res, error);
  } finally {
    if (connection) await connection.close();
  }
});

app.post("/api/purchases", requireDatabase, async (req, res) => {
  let connection;
  try {
    const studentId = requirePositiveInteger(req.body.studentId, "Student ID");
    const productId = requirePositiveInteger(req.body.productId, "Product ID");
    const quantity = requirePositiveInteger(req.body.quantity, "Quantity");
    if (req.body.reusableContainerUsed !== true && req.body.reusableContainerUsed !== false) {
      return res.status(400).json({ error: "Reusable-container selection must be true or false." });
    }

    connection = await pool.getConnection();
    const result = await connection.execute(
      `BEGIN
         process_purchase(
           :studentId,
           :productId,
           :quantity,
           :reusableContainerUsed,
           :orderId
         );
       END;`,
      {
        studentId,
        productId,
        quantity,
        reusableContainerUsed: req.body.reusableContainerUsed ? "Y" : "N",
        orderId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      }
    );
    await connection.commit();
    return res.status(201).json({ orderId: result.outBinds.orderId });
  } catch (error) {
    if (connection) await connection.rollback();
    return sendError(res, error);
  } finally {
    if (connection) await connection.close();
  }
});

app.post("/api/transfers", requireDatabase, async (req, res) => {
  let connection;
  try {
    const senderStudentId = requirePositiveInteger(req.body.senderStudentId, "Sender student ID");
    const receiverStudentId = requirePositiveInteger(req.body.receiverStudentId, "Receiver student ID");
    const amount = requirePositiveMoney(req.body.amount, "Transfer amount");
    if (senderStudentId === receiverStudentId) {
      return res.status(400).json({ error: "Sender and receiver must be different students." });
    }

    connection = await pool.getConnection();
    const walletsResult = await connection.execute(
      `SELECT student_id AS "studentId", wallet_id AS "walletId"
       FROM wallet_accounts
       WHERE student_id IN (:senderStudentId, :receiverStudentId)`,
      { senderStudentId, receiverStudentId }
    );
    const walletIds = new Map(walletsResult.rows.map((row) => [row.studentId, row.walletId]));
    const senderWalletId = walletIds.get(senderStudentId);
    const receiverWalletId = walletIds.get(receiverStudentId);
    if (!senderWalletId || !receiverWalletId) {
      return res.status(404).json({ error: "Sender or receiver wallet was not found." });
    }

    const result = await connection.execute(
      `BEGIN
         transfer_funds(:senderWalletId, :receiverWalletId, :amount, :transferId);
       END;`,
      {
        senderWalletId,
        receiverWalletId,
        amount,
        transferId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      }
    );
    await connection.commit();
    return res.status(201).json({ transferId: result.outBinds.transferId });
  } catch (error) {
    if (connection) await connection.rollback();
    return sendError(res, error);
  } finally {
    if (connection) await connection.close();
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

async function start() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port between 1 and 65535.");
  }

  if (!process.env.ORACLE_USER || !process.env.ORACLE_PASSWORD || !process.env.ORACLE_CONNECT_STRING) {
    console.error(
      "Oracle is not configured. Copy .env.example to .env and set ORACLE_USER, ORACLE_PASSWORD, and ORACLE_CONNECT_STRING."
    );
  } else {
    try {
      pool = await oracledb.createPool({
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
        connectString: process.env.ORACLE_CONNECT_STRING,
        poolMin: 1,
        poolMax: 5,
        poolIncrement: 1,
        poolTimeout: 60
      });
      console.log("Oracle connection pool is ready.");
    } catch (error) {
      console.error("Unable to connect to Oracle:", error.message);
    }
  }

  app.listen(port, "127.0.0.1", () => {
    console.log(`EcoCampus is available at http://127.0.0.1:${port}`);
    console.log("Local development only: this demo does not authenticate campus users.");
  });
}

start().catch((error) => {
  console.error("Unable to start EcoCampus:", error);
  process.exitCode = 1;
});
