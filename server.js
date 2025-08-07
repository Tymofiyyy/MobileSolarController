// server.js - ВИПРАВЛЕНИЙ для збереження пристроїв
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const mqtt = require('mqtt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Google OAuth2 Client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Middleware
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());

// PostgreSQL підключення
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'solar_controller',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

// MQTT підключення
const mqttOptions = {
  host: process.env.MQTT_HOST || 'localhost',
  port: process.env.MQTT_PORT || 1883,
  protocol: process.env.MQTT_PROTOCOL || 'mqtt',
  reconnectPeriod: 1000,
};

if (process.env.MQTT_USERNAME) {
  mqttOptions.username = process.env.MQTT_USERNAME;
  mqttOptions.password = process.env.MQTT_PASSWORD;
}

const mqttClient = mqtt.connect(mqttOptions);

// Зберігаємо статуси пристроїв в пам'яті
const deviceStatuses = new Map();
const deviceConfirmationCodes = new Map();

// MQTT обробники
mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  mqttClient.subscribe('solar/+/status');
  mqttClient.subscribe('solar/+/online');
});

mqttClient.on('error', (error) => {
  console.error('❌ MQTT connection error:', error);
});

mqttClient.on('message', async (topic, message) => {
  const topicParts = topic.split('/');
  const deviceId = topicParts[1];
  const messageType = topicParts[2];
  
  try {
    if (messageType === 'status') {
      const status = JSON.parse(message.toString());
      
      if (status.confirmationCode) {
        deviceConfirmationCodes.set(deviceId, status.confirmationCode);
        console.log(`📝 Received confirmation code for ${deviceId}: ${status.confirmationCode}`);
      }
      
      deviceStatuses.set(deviceId, {
        ...status,
        lastSeen: new Date(),
        online: true
      });
      
      // Зберігаємо в історію
      const deviceExists = await pool.query(
        'SELECT id FROM devices WHERE device_id = $1',
        [deviceId]
      );
      
      if (deviceExists.rows.length > 0) {
        await saveDeviceStatus(deviceId, status);
      }
      
    } else if (messageType === 'online') {
      const isOnline = message.toString() === 'true';
      const currentStatus = deviceStatuses.get(deviceId) || {};
      deviceStatuses.set(deviceId, {
        ...currentStatus,
        online: isOnline,
        lastSeen: new Date()
      });
    }
  } catch (error) {
    console.error(`Error processing MQTT message:`, error);
  }
});

// Middleware для автентифікації
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  // Тестовий токен
  if (token === 'test-token-12345') {
    try {
      // Створюємо або отримуємо тестового користувача
      const testUser = await getOrCreateTestUser('test@solar.com', 'test-google-id');
      req.user = {
        id: testUser.id,
        email: testUser.email,
        googleId: testUser.google_id
      };
      return next();
    } catch (error) {
      console.error('Error creating test user:', error);
      return res.status(500).json({ error: 'Failed to create test user' });
    }
  }
  
  // Тимчасовий веб-токен
  if (token.startsWith('web-temp-token-')) {
    try {
      const googleId = token.replace('web-temp-token-', '');
      const webUser = await getOrCreateTestUser('webuser@solar.com', googleId);
      req.user = {
        id: webUser.id,
        email: webUser.email,
        googleId: googleId
      };
      return next();
    } catch (error) {
      console.error('Error creating web user:', error);
      return res.status(500).json({ error: 'Failed to create web user' });
    }
  }
  
  // JWT перевірка
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Функція для отримання або створення тестового користувача
async function getOrCreateTestUser(email, googleId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Перевіряємо чи існує користувач
    let user = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    if (user.rows.length === 0) {
      // Створюємо нового користувача
      user = await client.query(
        `INSERT INTO users (google_id, email, name, picture, created_at, last_login) 
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
         RETURNING *`,
        [googleId || 'test-' + Date.now(), email, 'Test User', null]
      );
      console.log(`✅ Created test user: ${email}`);
    } else {
      // Оновлюємо last_login
      user = await client.query(
        `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE email = $1 RETURNING *`,
        [email]
      );
      console.log(`✅ Updated test user: ${email}`);
    }
    
    await client.query('COMMIT');
    return user.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ========== API ROUTES ==========

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mqtt: mqttClient.connected,
    timestamp: new Date()
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Solar Controller API',
    version: '1.0.0'
  });
});

// Test login
app.post('/api/auth/test', async (req, res) => {
  try {
    const user = await getOrCreateTestUser('test@solar.com', 'test-google-id');
    
    const token = jwt.sign(
      { 
        id: user.id,
        googleId: user.google_id,
        email: user.email
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture
      }
    });
  } catch (error) {
    console.error('Error in test login:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Google OAuth2 login
app.post('/api/auth/google', async (req, res) => {
  const client = await pool.connect();
  try {
    const { credential } = req.body;
    
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const googleId = payload['sub'];
    const email = payload['email'];
    const name = payload['name'];
    const picture = payload['picture'];
    
    await client.query('BEGIN');
    
    let user = await client.query(
      'SELECT * FROM users WHERE google_id = $1',
      [googleId]
    );
    
    if (user.rows.length === 0) {
      user = await client.query(
        `INSERT INTO users (google_id, email, name, picture, created_at, last_login) 
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
         RETURNING *`,
        [googleId, email, name, picture]
      );
    } else {
      user = await client.query(
        `UPDATE users 
         SET email = $2, name = $3, picture = $4, last_login = CURRENT_TIMESTAMP
         WHERE google_id = $1
         RETURNING *`,
        [googleId, email, name, picture]
      );
    }
    
    await client.query('COMMIT');
    
    const token = jwt.sign(
      { 
        id: user.rows[0].id,
        googleId: user.rows[0].google_id,
        email: user.rows[0].email
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: {
        id: user.rows[0].id,
        email: user.rows[0].email,
        name: user.rows[0].name,
        picture: user.rows[0].picture
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in Google auth:', error);
    res.status(500).json({ error: 'Authentication failed' });
  } finally {
    client.release();
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, picture FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all devices
app.get('/api/devices', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT d.*, ud.is_owner, ud.added_at
       FROM devices d
       JOIN user_devices ud ON d.id = ud.device_id
       WHERE ud.user_id = $1
       ORDER BY ud.added_at DESC`,
      [req.user.id]
    );
    
    const devices = result.rows.map(device => ({
      ...device,
      status: deviceStatuses.get(device.device_id) || { online: false }
    }));
    
    res.json(devices);
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add device
app.post('/api/devices', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { deviceId, confirmationCode, name } = req.body;
    
    // Перевірка коду підтвердження
    const storedCode = deviceConfirmationCodes.get(deviceId);
    if (!storedCode || storedCode !== confirmationCode) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid confirmation code or device not found' });
    }
    
    // Перевіряємо чи існує пристрій
    let deviceResult = await client.query(
      'SELECT id FROM devices WHERE device_id = $1',
      [deviceId]
    );
    
    let deviceDbId;
    let isNewDevice = false;
    
    if (deviceResult.rows.length === 0) {
      // Створюємо новий пристрій
      deviceResult = await client.query(
        'INSERT INTO devices (device_id, name) VALUES ($1, $2) RETURNING id',
        [deviceId, name || `Solar Controller ${deviceId.slice(-4)}`]
      );
      deviceDbId = deviceResult.rows[0].id;
      isNewDevice = true;
    } else {
      deviceDbId = deviceResult.rows[0].id;
    }
    
    // Перевіряємо чи користувач вже має доступ
    const accessCheck = await client.query(
      'SELECT * FROM user_devices WHERE user_id = $1 AND device_id = $2',
      [req.user.id, deviceDbId]
    );
    
    if (accessCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You already have access to this device' });
    }
    
    // Додаємо зв'язок користувач-пристрій
    await client.query(
      'INSERT INTO user_devices (user_id, device_id, is_owner) VALUES ($1, $2, $3)',
      [req.user.id, deviceDbId, isNewDevice]
    );
    
    await client.query('COMMIT');
    
    // Повертаємо повну інформацію про пристрій
    const fullDevice = await client.query(
      `SELECT d.*, ud.is_owner, ud.added_at
       FROM devices d
       JOIN user_devices ud ON d.id = ud.device_id
       WHERE d.id = $1 AND ud.user_id = $2`,
      [deviceDbId, req.user.id]
    );
    
    const device = {
      ...fullDevice.rows[0],
      status: deviceStatuses.get(deviceId) || { online: false }
    };
    
    res.json(device);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding device:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Control device
app.post('/api/devices/:deviceId/control', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { command, state } = req.body;
    
    console.log(`🎮 Control command for ${deviceId}: ${command} = ${state}`);
    
    // Перевіряємо доступ
    const accessCheck = await pool.query(
      `SELECT 1 FROM user_devices ud
       JOIN devices d ON d.id = ud.device_id
       WHERE ud.user_id = $1 AND d.device_id = $2`,
      [req.user.id, deviceId]
    );
    
    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Публікуємо команду в MQTT
    const topic = `solar/${deviceId}/command`;
    const payload = JSON.stringify({ command, state });
    
    mqttClient.publish(topic, payload, (error) => {
      if (error) {
        console.error(`❌ MQTT publish error:`, error);
        res.status(500).json({ error: 'Failed to send command' });
      } else {
        console.log(`✅ Command sent to ${deviceId}`);
        
        // Оновлюємо локальний статус для швидкого відгуку
        const currentStatus = deviceStatuses.get(deviceId) || {};
        deviceStatuses.set(deviceId, {
          ...currentStatus,
          relayState: state,
          lastUpdated: new Date()
        });
        
        res.json({ success: true });
      }
    });
  } catch (error) {
    console.error('Error controlling device:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete device
app.delete('/api/devices/:deviceId', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { deviceId } = req.params;
    
    const deviceResult = await pool.query(
      'SELECT id FROM devices WHERE device_id = $1',
      [deviceId]
    );
    
    if (deviceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const deviceDbId = deviceResult.rows[0].id;
    
    // Видаляємо зв'язок користувач-пристрій
    await client.query(
      'DELETE FROM user_devices WHERE user_id = $1 AND device_id = $2',
      [req.user.id, deviceDbId]
    );
    
    // Перевіряємо чи залишились інші користувачі
    const remainingUsers = await pool.query(
      'SELECT COUNT(*) FROM user_devices WHERE device_id = $1',
      [deviceDbId]
    );
    
    // Якщо користувачів не залишилось, видаляємо пристрій
    if (parseInt(remainingUsers.rows[0].count) === 0) {
      await client.query(
        'DELETE FROM devices WHERE id = $1',
        [deviceDbId]
      );
    }
    
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting device:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Share device - тільки з існуючими користувачами
app.post('/api/devices/:deviceId/share', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { deviceId } = req.params;
    const { email } = req.body;
    
    // Перевіряємо чи користувач є власником
    const ownerResult = await client.query(
      `SELECT ud.is_owner 
       FROM user_devices ud
       JOIN devices d ON d.id = ud.device_id
       WHERE ud.user_id = $1 AND d.device_id = $2`,
      [req.user.id, deviceId]
    );
    
    if (ownerResult.rows.length === 0 || !ownerResult.rows[0].is_owner) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only owner can share device' });
    }
    
    // Шукаємо користувача за email
    const targetUser = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    
    if (targetUser.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found. They need to register first.' });
    }
    
    const targetUserId = targetUser.rows[0].id;
    
    // Знаходимо пристрій
    const deviceResult = await client.query(
      'SELECT id FROM devices WHERE device_id = $1',
      [deviceId]
    );
    
    const deviceDbId = deviceResult.rows[0].id;
    
    // Перевіряємо чи вже має доступ
    const existingAccess = await client.query(
      'SELECT * FROM user_devices WHERE user_id = $1 AND device_id = $2',
      [targetUserId, deviceDbId]
    );
    
    if (existingAccess.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'User already has access to this device' });
    }
    
    // Додаємо доступ
    await client.query(
      'INSERT INTO user_devices (user_id, device_id, is_owner) VALUES ($1, $2, false)',
      [targetUserId, deviceDbId]
    );
    
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error sharing device:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get all registered users (for sharing)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name FROM users WHERE id != $1 ORDER BY name',
      [req.user.id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions
async function saveDeviceStatus(deviceId, status) {
  try {
    await pool.query(
      `INSERT INTO device_history (device_id, relay_state, wifi_rssi, uptime, free_heap)
       VALUES ($1, $2, $3, $4, $5)`,
      [deviceId, status.relayState, status.wifiRSSI, status.uptime, status.freeHeap]
    );
  } catch (error) {
    console.error('Error saving device status:', error);
  }
}

async function initDatabase() {
  try {
    console.log('🔍 Checking database connection...');
    
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected at:', result.rows[0].now);
    
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    if (tables.rows.length === 0) {
      console.log('⚠️  No tables found. Please run: node reset-database.js');
    } else {
      console.log('📊 Found tables:', tables.rows.map(t => t.table_name).join(', '));
    }
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    console.log('💡 Make sure PostgreSQL is running and database exists');
    process.exit(1);
  }
}

// Періодичні завдання
setInterval(() => {
  const now = new Date();
  deviceStatuses.forEach((status, deviceId) => {
    const timeSinceLastSeen = now - status.lastSeen;
    if (timeSinceLastSeen > 30000 && status.online) {
      status.online = false;
      console.log(`🔴 Device ${deviceId} marked as offline`);
    }
  });
}, 30000);

// Start server
app.listen(PORT, async () => {
  console.log('\n🚀 Solar Controller Backend Server');
  console.log('==================================');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌐 API URL: http://localhost:${PORT}`);
  console.log(`📊 Database: ${process.env.DB_NAME || 'solar_controller'}`);
  console.log(`🔌 MQTT Broker: ${process.env.MQTT_HOST || 'localhost'}:${process.env.MQTT_PORT || 1883}`);
  console.log('==================================\n');
  
  await initDatabase();
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  SIGTERM signal received');
  mqttClient.end();
  pool.end();
  process.exit(0);
});