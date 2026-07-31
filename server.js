const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const Database = require("better-sqlite3");

const app = express();
app.use(express.json());
app.use(cors());

// Initialize SQLite Database
const db = new Database("database.sqlite");

// Create Products Table for Account Cards
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    subtext TEXT,
    price TEXT,
    image_url TEXT,
    badge TEXT
  )
`);

// Configure Nodemailer to Send Email Alerts
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.CLIENT_NOTIFICATION_EMAIL,
    pass: process.env.CLIENT_EMAIL_PASSWORD
  }
});

/* ===============================
   1. PAYMENT VERIFICATION ROUTE
=============================== */
app.post("/api/verify-payment", async (req, res) => {
  const { email, txid, orderId, amount } = req.body;

  if (!txid || !email) {
    return res.status(400).json({ success: false, message: "Missing required details." });
  }

  try {
    // Verify payment against NOWPayments
    const response = await fetch("https://api.nowpayments.io/v1/payment/?limit=100", {
      headers: { "x-api-key": process.env.NOWPAYMENTS_API_KEY }
    });
    const data = await response.json();

    const matchingPayment = data.payments?.find(
      (p) => p.payin_hash?.toLowerCase() === txid.toLowerCase() && p.payment_status === "finished"
    );

    if (matchingPayment) {
      // Send Email Alert to Client
      const mailOptions = {
        from: process.env.CLIENT_NOTIFICATION_EMAIL,
        to: process.env.CLIENT_NOTIFICATION_EMAIL,
        subject: `🚨 New Order Confirmed! [Order ${orderId}]`,
        html: `
          <h2>New Payment Received!</h2>
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p><strong>Customer Email:</strong> ${email}</p>
          <p><strong>Amount:</strong> ${amount}</p>
          <p><strong>Transaction Hash (TXID):</strong> <code>${txid}</code></p>
          <p>Please deliver the account details to the customer.</p>
        `
      };

      transporter.sendMail(mailOptions, (err, info) => {
        if (err) console.error("Email notification error:", err);
        else console.log("Notification email sent successfully:", info.response);
      });

      return res.json({ success: true, message: "Payment verified successfully!" });

    } else {
      return res.status(400).json({ 
        success: false, 
        message: "Transaction Hash not found or payment status is not finished." 
      });
    }

  } catch (err) {
    console.error("Verification error:", err);
    return res.status(500).json({ success: false, message: "Server error during verification." });
  }
});

/* ===============================
   2. ACCOUNT CARD MANAGEMENT ROUTES
=============================== */

// Public: Fetch all account cards for the main website
app.get("/api/products", (req, res) => {
  try {
    const products = db.prepare("SELECT * FROM products").all();
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load products" });
  }
});

// Admin: Save or update an account card
app.post("/api/admin/products", (req, res) => {
  const clientSecret = req.headers["x-admin-secret"];
  if (clientSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid Secret Key" });
  }

  const { id, title, subtext, price, image_url, badge } = req.body;

  if (id) {
    const stmt = db.prepare(`
      UPDATE products 
      SET title=?, subtext=?, price=?, image_url=?, badge=? 
      WHERE id=?
    `);
    stmt.run(title, subtext, price, image_url, badge, id);
  } else {
    const stmt = db.prepare(`
      INSERT INTO products (title, subtext, price, image_url, badge) 
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(title, subtext, price, image_url, badge);
  }

  res.json({ success: true, message: "Card saved successfully!" });
});

// Admin: Delete an account card
app.delete("/api/admin/products/:id", (req, res) => {
  const clientSecret = req.headers["x-admin-secret"];
  if (clientSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  res.json({ success: true, message: "Card deleted" });
});

/* ===============================
   3. START SERVER
=============================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));