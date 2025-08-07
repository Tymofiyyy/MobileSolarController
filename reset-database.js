// reset-database.js - Скрипт для створення та перезапуску бази даних
const { Pool } = require('pg');
require('dotenv').config();

// Створюємо підключення до PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER || 'iot_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'iot_devices',
  password: process.env.DB_PASSWORD || 'Tomwoker159357',
  port: process.env.DB_PORT || 5432,
});

async function resetDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🗑️  Видаляємо старі таблиці...');
    
    // Видаляємо таблиці в правильному порядку (через foreign keys)
    await client.query('DROP TABLE IF EXISTS device_history CASCADE');
    await client.query('DROP TABLE IF EXISTS user_devices CASCADE');
    await client.query('DROP TABLE IF EXISTS devices CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE');
    
    console.log('✅ Старі таблиці видалено');
    
    console.log('🏗️  Створюємо нові таблиці...');
    
    // Створюємо таблицю користувачів
    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        picture TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблиця users створена');
    
    // Створюємо таблицю пристроїв
    await client.query(`
      CREATE TABLE devices (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблиця devices створена');
    
    // Створюємо зв'язну таблицю користувач-пристрій
    await client.query(`
      CREATE TABLE user_devices (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
        is_owner BOOLEAN DEFAULT false,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, device_id)
      )
    `);
    console.log('✅ Таблиця user_devices створена');
    
    // Створюємо таблицю історії пристроїв
    await client.query(`
      CREATE TABLE device_history (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(255),
        relay_state BOOLEAN,
        wifi_rssi INTEGER,
        uptime INTEGER,
        free_heap INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблиця device_history створена');
    
    // Створюємо індекси для кращої продуктивності
    console.log('📇 Створюємо індекси...');
    
    await client.query('CREATE INDEX idx_users_google_id ON users(google_id)');
    await client.query('CREATE INDEX idx_users_email ON users(email)');
    await client.query('CREATE INDEX idx_devices_device_id ON devices(device_id)');
    await client.query('CREATE INDEX idx_device_history_device_id_timestamp ON device_history(device_id, timestamp DESC)');
    await client.query('CREATE INDEX idx_user_devices_user_id ON user_devices(user_id)');
    await client.query('CREATE INDEX idx_user_devices_device_id ON user_devices(device_id)');
    
    console.log('✅ Індекси створено');
    
    // Виводимо інформацію про створені таблиці
    console.log('\n📊 Структура бази даних:');
    
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\nТаблиці:');
    tables.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    console.log('\n🎉 База даних успішно створена!');
    console.log('\n💡 Тепер можна запускати сервер: npm start');
    
  } catch (error) {
    console.error('❌ Помилка при створенні бази даних:', error.message);
    console.error('\n🔍 Перевірте:');
    console.error('  1. Чи запущений PostgreSQL?');
    console.error('  2. Чи правильні налаштування в .env файлі?');
    console.error('  3. Чи існує база даних iot_devices?');
    console.error('\nЩоб створити базу даних вручну:');
    console.error('  psql -U postgres');
    console.error('  CREATE DATABASE iot_devices;');
    console.error('  CREATE USER iot_user WITH PASSWORD \'Tomwoker159357\';');
    console.error('  GRANT ALL PRIVILEGES ON DATABASE iot_devices TO iot_user;');
    
  } finally {
    client.release();
    pool.end();
  }
}

// Запускаємо скрипт
console.log('🚀 Solar Controller - Database Reset Script');
console.log('==========================================\n');

resetDatabase();