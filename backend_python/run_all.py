import subprocess
import sys
import time
import os

if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

python_exe = sys.executable

print("[CHAOSGUARD-PYTHON] Starting all 3 Python backend services...")

# 1. Start Payment Service (Port 5001)
p_payment = subprocess.Popen(
    [python_exe, "-m", "uvicorn", "payment_service:app", "--host", "0.0.0.0", "--port", "5001", "--log-level", "warning"],
    cwd=os.path.dirname(os.path.abspath(__file__))
)
print("[PAYMENT-SERVICE] Started on http://localhost:5001")

# 2. Start Order Service (Port 5000)
p_order = subprocess.Popen(
    [python_exe, "-m", "uvicorn", "order_service:app", "--host", "0.0.0.0", "--port", "5000", "--log-level", "warning"],
    cwd=os.path.dirname(os.path.abspath(__file__))
)
print("[ORDER-SERVICE] Started on http://localhost:5000")

# 3. Start Chaos Engine (Port 4000)
p_chaos = subprocess.Popen(
    [python_exe, "-m", "uvicorn", "chaos_engine:app", "--host", "0.0.0.0", "--port", "4000", "--log-level", "warning"],
    cwd=os.path.dirname(os.path.abspath(__file__))
)
print("[CHAOS-ENGINE] Started on http://localhost:4000")

print("[CHAOSGUARD-PYTHON] All Python backend services are running!")

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("Stopping Python services...")
    p_payment.terminate()
    p_order.terminate()
    p_chaos.terminate()
