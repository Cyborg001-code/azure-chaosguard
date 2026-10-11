import { createOrderApp } from './services/orderService.js';
import { createPaymentApp } from './services/paymentService.js';

const ORDER_PORT = process.env.ORDER_PORT || 5000;
const PAYMENT_PORT = process.env.PAYMENT_PORT || 5001;
const PAYMENT_URL = process.env.PAYMENT_SERVICE_URL || `http://localhost:${PAYMENT_PORT}`;

// 1. Start Payment Service
const paymentApp = createPaymentApp();
const paymentServer = paymentApp.listen(PAYMENT_PORT, () => {
  console.log(`💳 [PAYMENT-SERVICE] Running on port ${PAYMENT_PORT}`);
  console.log(`   └─ Health: http://localhost:${PAYMENT_PORT}/api/health`);
  console.log(`   └─ Chaos Fault API: http://localhost:${PAYMENT_PORT}/faults/inject`);
});

// 2. Start Order Service
const orderApp = createOrderApp(PAYMENT_URL);
const orderServer = orderApp.listen(ORDER_PORT, () => {
  console.log(`📦 [ORDER-SERVICE] Running on port ${ORDER_PORT}`);
  console.log(`   └─ Health: http://localhost:${ORDER_PORT}/api/health`);
  console.log(`   └─ Resilience Metrics: http://localhost:${ORDER_PORT}/api/resilience/metrics`);
  console.log(`   └─ Create Order: POST http://localhost:${ORDER_PORT}/api/orders`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Stopping target microservices...');
  paymentServer.close();
  orderServer.close();
});
