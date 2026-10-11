# How to Connect Your Microsoft Azure Account to Azure ChaosGuard

This project includes a built-in cloud connector that allows you to seamlessly switch between **Safe Local Simulation Mode** and **Live Microsoft Azure Cloud**.

---

## ⚡ Option 1: 1-Click Connection via Azure CLI (Easiest)

If you have the Azure CLI installed on your machine:

1. Open your terminal in this repository.
2. Run:
   ```bash
   az login
   ```
3. A browser window will open. Sign into your Microsoft Azure account and select your subscription.
4. Run the connection test:
   ```powershell
   .\connect_azure.ps1
   ```
   *or*
   ```bash
   python backend_python/azure_connector.py
   ```
5. **Done!** Azure ChaosGuard will automatically detect your active subscription and tenant identity.

---

## 🔑 Option 2: Service Principal & Configuration File (`.env.azure`)

If you want automated cloud access (ideal for CI/CD pipelines, production servers, or without browser sign-in):

1. Open the file [`.env.azure`](file:///i:/Project/first-antigravity/.env.azure) in the root directory.
2. Create an Azure Service Principal by running:
   ```bash
   az ad sp create-for-rbac --name "sp-chaosguard" --role contributor --scopes /subscriptions/<YOUR_SUBSCRIPTION_ID>
   ```
3. Copy the output values into [`.env.azure`](file:///i:/Project/first-antigravity/.env.azure):
   ```ini
   AZURE_SUBSCRIPTION_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   AZURE_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   AZURE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   AZURE_RESOURCE_GROUP=rg-chaosguard-prod
   AZURE_LOCATION=eastus
   ```
4. *(Optional Target Services)* Paste your Azure connection strings:
   * **Azure Cosmos DB:** Connection String from *Azure Portal $\rightarrow$ Cosmos DB Account $\rightarrow$ Keys*.
   * **Azure Redis Cache:** Host & Primary Key from *Azure Portal $\rightarrow$ Redis $\rightarrow$ Access Keys*.
   * **Azure Application Insights:** Connection string from *Azure Portal $\rightarrow$ App Insights*.
   * **Azure OpenAI:** Endpoint & API Key from *Azure Portal $\rightarrow$ Azure OpenAI $\rightarrow$ Keys and Endpoint*.

---

## 🛡️ Security Note

* Your real keys will **never** be committed to Git. The `.gitignore` file is pre-configured to exclude sensitive local files (`.env`, `.env.local`, etc.).
* Until you connect your real Azure account, the platform runs in **Safe Local Simulation Mode**, so you can test all features (Stress Testing, Multi-Region Failover, Fire Drills, AI Scorecards, Cost Analyzer) without incurring cloud charges.

---

## 🔍 Verification

To verify your connection at any time:
```powershell
python backend_python/azure_connector.py
```
Or view the connection status live in the bottom-left corner of the ChaosGuard web dashboard at [http://localhost:3000](http://localhost:3000).
