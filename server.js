const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// File path for products storage
const PRODUCTS_FILE = path.join(__dirname, "products.json");

// Helper function to read products from JSON file
function getProducts() {
  if (!fs.existsSync(PRODUCTS_FILE)) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    const data = fs.readFileSync(PRODUCTS_FILE, "utf8");
    return JSON.parse(data || "[]");
  } catch (err) {
    return [];
  }
}

// Helper function to save products to JSON file
function saveProducts(products) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

// Configure Nodemailer using Render Environment Variables
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.CLIENT_NOTIFICATION_EMAIL,
    pass: process.env.ADMIN_EMAIL_PASSWORD
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
    const response = await fetch("https://api.nowpayments.io/v1/payment/?limit=100", {
      headers: { "x-api-key": process.env.NOWPAYMENTS_API_KEY }
    });
    const data = await response.json();

    const matchingPayment = data.payments?.find(
      (p) => p.payin_hash?.toLowerCase() === txid.toLowerCase() && p.payment_status === "finished"
    );

    if (matchingPayment) {
      // Send Email Alert
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

// Public: Fetch all account cards for main website
app.get("/api/products", (req, res) => {
  const products = getProducts();
  res.json({ success: true, products });
});

// Admin: Save or update an account card
app.post("/api/admin/products", (req, res) => {
  const clientSecret = req.headers["x-admin-secret"];
  const secret = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;

  if (clientSecret !== secret) {
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid Passcode" });
  }

  const { id, title, subtext, price, image_url, badge } = req.body;
  let products = getProducts();

  if (id) {
    // Update existing product
    products = products.map(p => p.id === parseInt(id) ? { id: parseInt(id), title, subtext, price, image_url, badge } : p);
  } else {
    // Insert new product
    const newProduct = {
      id: Date.now(),
      title,
      subtext,
      price,
      image_url,
      badge
    };
    products.push(newProduct);
  }

  saveProducts(products);
  res.json({ success: true, message: "Card saved successfully!" });
});

// Admin: Delete an account card
app.delete("/api/admin/products/:id", (req, res) => {
  const clientSecret = req.headers["x-admin-secret"];
  const secret = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;

  if (clientSecret !== secret) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  let products = getProducts();
  products = products.filter(p => p.id !== parseInt(req.params.id));
  saveProducts(products);

  res.json({ success: true, message: "Card deleted" });
});

/* ===============================
   3. START SERVER
=============================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));