import os
import sys
import subprocess
import json
from pathlib import Path
from typing import Dict, Any

# Ensure stdout handles UTF-8 safely
try:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ENV_FILE_PATH = Path(__file__).parent.parent / ".env.azure"

def load_azure_env() -> Dict[str, str]:
    """
    Loads variables from .env.azure or fallback to os.environ.
    Preserves existing system environment variables.
    """
    config: Dict[str, str] = {}
    if ENV_FILE_PATH.exists():
        try:
            with open(ENV_FILE_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        config[k.strip()] = v.strip()
        except Exception as e:
            print(f"[AZURE-CONNECTOR] Warning reading .env.azure: {e}")

    # Allow system environment variables to override
    for k in list(config.keys()):
        if k in os.environ and os.environ[k]:
            config[k] = os.environ[k]

    return config

def is_placeholder(val: str) -> bool:
    if not val:
        return True
    lower = val.lower()
    return "your-" in lower or "here" in lower or "<" in lower or "placeholder" in lower

def get_azure_status() -> Dict[str, Any]:
    """
    Evaluates whether the system is connected to live Microsoft Azure
    or running in safe local simulation mode.
    """
    config = load_azure_env()

    sub_id = config.get("AZURE_SUBSCRIPTION_ID", "")
    tenant_id = config.get("AZURE_TENANT_ID", "")
    client_id = config.get("AZURE_CLIENT_ID", "")
    client_secret = config.get("AZURE_CLIENT_SECRET", "")
    resource_group = config.get("AZURE_RESOURCE_GROUP", "rg-chaosguard-prod")
    location = config.get("AZURE_LOCATION", "eastus")

    # Check CLI status as a fallback
    cli_logged_in = False
    cli_account = None
    try:
        res = subprocess.run(["az", "account", "show"], capture_output=True, text=True, timeout=2)
        if res.returncode == 0 and res.stdout:
            cli_account = json.loads(res.stdout)
            cli_logged_in = True
    except Exception:
        cli_logged_in = False

    has_sp_credentials = (
        not is_placeholder(sub_id) and 
        not is_placeholder(tenant_id) and 
        not is_placeholder(client_id) and 
        not is_placeholder(client_secret)
    )

    is_live = has_sp_credentials or cli_logged_in

    # Check connected target services
    cosmos_configured = not is_placeholder(config.get("AZURE_COSMOS_ENDPOINT", ""))
    redis_configured = not is_placeholder(config.get("AZURE_REDIS_HOST", ""))
    insights_configured = not is_placeholder(config.get("APPLICATIONINSIGHTS_CONNECTION_STRING", ""))
    signalr_configured = not is_placeholder(config.get("AZURE_SIGNALR_CONNECTION_STRING", ""))
    openai_configured = not is_placeholder(config.get("AZURE_OPENAI_API_KEY", ""))

    active_sub = (cli_account.get("id") if cli_account else sub_id) if is_live else "None (Local Simulation)"
    active_tenant = (cli_account.get("tenantId") if cli_account else tenant_id) if is_live else "None (Local Simulation)"

    return {
        "isLive": is_live,
        "mode": "LIVE_AZURE_CLOUD" if is_live else "LOCAL_SIMULATION",
        "authMethod": "AZURE_CLI" if cli_logged_in else ("SERVICE_PRINCIPAL" if has_sp_credentials else "SIMULATED"),
        "subscriptionId": active_sub,
        "tenantId": active_tenant,
        "resourceGroup": resource_group,
        "location": location,
        "budgetCeilingUsd": float(config.get("CHAOS_BUDGET_CEILING_USD", "2.00")),
        "services": {
            "cosmosDb": {"configured": cosmos_configured, "endpoint": config.get("AZURE_COSMOS_ENDPOINT", "simulated-local")},
            "redisCache": {"configured": redis_configured, "host": config.get("AZURE_REDIS_HOST", "simulated-local")},
            "applicationInsights": {"configured": insights_configured},
            "signalR": {"configured": signalr_configured},
            "azureOpenAI": {"configured": openai_configured, "endpoint": config.get("AZURE_OPENAI_ENDPOINT", "simulated-heuristic")}
        },
        "instructions": (
            "Connected to live Azure subscription." if is_live else
            "Running in safe local simulation mode. To connect to live Azure, edit '.env.azure' or run 'az login'."
        )
    }

def print_diagnostic():
    status = get_azure_status()
    print("=" * 70)
    print("      AZURE CHAOSGUARD - CLOUD ACCOUNT CONNECTION STATUS")
    print("=" * 70)
    print(f" Mode:            {status['mode']}")
    print(f" Auth Method:     {status['authMethod']}")
    print(f" Subscription ID: {status['subscriptionId']}")
    print(f" Resource Group:  {status['resourceGroup']}")
    print(f" Primary Region:  {status['location']}")
    print("-" * 70)
    print(" Target Services Configuration:")
    for name, s in status["services"].items():
        state = "[CONNECTED]" if s["configured"] else "[SIMULATED / PENDING]"
        print(f"   • {name:20}: {state}")
    print("-" * 70)
    print(f" Status: {status['instructions']}")
    print("=" * 70)

if __name__ == "__main__":
    print_diagnostic()
