require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

let db;

// 1. Database Setup
(async () => {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            platform TEXT NOT NULL,
            followers TEXT NOT NULL,
            age TEXT NOT NULL,
            location TEXT NOT NULL,
            price REAL NOT NULL,
            profit REAL NOT NULL,
            badge TEXT,
            images TEXT NOT NULL,
            status TEXT DEFAULT 'AVAILABLE'
        );

        CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            account_id INTEGER,
            customer_email TEXT,
            amount REAL,
            payment_status TEXT DEFAULT 'PENDING'
        );
    `);

    // Add starter data if database is empty
    const count = await db.get('SELECT COUNT(*) as count FROM accounts');
    if (count.count === 0) {
        await db.run(`
            INSERT INTO accounts (title, platform, followers, age, location, price, profit, badge, images)
            VALUES 
            ('Soulgrit', 'youtube', '1.6M Subscribers', '3 Yrs Old', 'India', 2700, 196, 'MONETIZED', '["acc1.png"]'),
            ('Brezplug', 'youtube', '375.5k Subscribers', '20 Yrs Old', 'Denmark', 21900, 11742, 'HIGH REVENUE', '["ac1.png"]')
        `);
    }
})();

// Middleware to check Admin Password Token
const authenticateAdmin = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized access' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (err) {
        res.status(403).json({ error: 'Invalid Token' });
    }
};

// --- PUBLIC ROUTES FOR FRONTEND ---

// Get available accounts
app.get('/api/accounts', async (req, res) => {
    try {
        const accounts = await db.all("SELECT * FROM accounts WHERE status = 'AVAILABLE'");
        const formatted = accounts.map(acc => ({ ...acc, images: JSON.parse(acc.images) }));
        res.json({ success: true, data: formatted });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create Crypto Payment Invoice
app.post('/api/payments/create-crypto-invoice', async (req, res) => {
    const { account_id, email } = req.body;

    try {
        const account = await db.get('SELECT * FROM accounts WHERE id = ? AND status = "AVAILABLE"', [account_id]);
        if (!account) return res.status(400).json({ error: 'Account not available' });

        const orderId = 'HH-' + Math.floor(100000 + Math.random() * 900000);

        const response = await axios.post(
            'https://api.nowpayments.io/v1/payment',
            {
                price_amount: account.price,
                price_currency: 'usd',
                pay_currency: 'usdttrc20',
                ipn_callback_url: `${process.env.FRONTEND_URL}/api/webhooks/nowpayments`,
                order_id: orderId,
                order_description: `Purchase of ${account.title}`
            },
            {
                headers: {
                    'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        await db.run(
            'INSERT INTO orders (order_id, account_id, customer_email, amount) VALUES (?, ?, ?, ?)',
            [orderId, account_id, email, account.price]
        );

        res.json({
            success: true,
            orderId: orderId,
            payAddress: response.data.pay_address,
            payAmount: response.data.pay_amount
        });

    } catch (err) {
        res.status(500).json({ error: 'Payment initialization failed' });
    }
});

// --- ADMIN DASHBOARD ROUTES ---

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
        return res.json({ success: true, token });
    }
    res.status(401).json({ error: 'Wrong Admin Password' });
});

// Fetch all accounts for admin
app.get('/api/admin/accounts', authenticateAdmin, async (req, res) => {
    const accounts = await db.all('SELECT * FROM accounts ORDER BY id DESC');
    const formatted = accounts.map(a => ({ ...a, images: JSON.parse(a.images) }));
    res.json({ success: true, data: formatted });
});

// Add a new account listing
app.post('/api/admin/accounts', authenticateAdmin, async (req, res) => {
    const { title, platform, followers, age, location, price, profit, badge, images } = req.body;
    await db.run(
        `INSERT INTO accounts (title, platform, followers, age, location, price, profit, badge, images) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, platform || 'youtube', followers, age, location, price, profit, badge || 'MONETIZED', JSON.stringify(images || ["acc1.png"])]
    );
    res.json({ success: true });
});

// Toggle Sold / Available
app.patch('/api/admin/accounts/:id/status', authenticateAdmin, async (req, res) => {
    const { status } = req.body;
    await db.run('UPDATE accounts SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
});

// Delete account
app.delete('/api/admin/accounts/:id', authenticateAdmin, async (req, res) => {
    await db.run('DELETE FROM accounts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));

// Payment Verification Endpoint
app.post("/api/verify-payment", async (req, res) => {
    const { email, txid, orderId, amount } = req.body;

    if (!txid || !email) {
        return res.status(400).json({ 
            success: false, 
            message: "Missing required details (email or TXID)." 
        });
    }

    try {
        // Query NOWPayments API using the environment variable key
        const response = await fetch("https://api.nowpayments.io/v1/payment/?limit=100", {
            method: "GET",
            headers: {
                "x-api-key": process.env.NOWPAYMENTS_API_KEY
            }
        });

        const data = await response.json();

        // Search for matching payment transaction hash
        const matchingPayment = data.payments?.find(
            (p) => p.payin_hash?.toLowerCase() === txid.toLowerCase() && p.payment_status === "finished"
        );

        if (matchingPayment) {
            return res.json({ 
                success: true, 
                message: "Payment successfully verified!" 
            });
        } else {
            return res.status(400).json({ 
                success: false, 
                message: "Transaction Hash not found or payment status is not finished." 
            });
        }

    } catch (err) {
        console.error("Verification Error:", err);
        return res.status(500).json({ 
            success: false, 
            message: "Server error during verification. Try again later." 
        });
    }
});
