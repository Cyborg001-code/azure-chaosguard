# ==============================================================================
# Azure ChaosGuard - Microsoft Azure Cloud Connection Helper
# ==============================================================================
# Run this script whenever you are ready to connect your Azure account!
# ==============================================================================

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "       AZURE CHAOSGUARD - CLOUD ACCOUNT CONNECTION WIZARD             " -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check Python environment
Write-Host "[1/3] Checking Python Connector..." -ForegroundColor Yellow
if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "  Python detected successfully." -ForegroundColor Green
} else {
    Write-Host "  Python is required to run ChaosGuard backend." -ForegroundColor Red
}

# Step 2: Check Azure CLI Login
Write-Host "[2/3] Checking Azure CLI Status..." -ForegroundColor Yellow
$azInstalled = Get-Command az -ErrorAction SilentlyContinue

if ($azInstalled) {
    Write-Host "  Azure CLI is installed." -ForegroundColor Green
    $azAccount = az account show --output json 2>$null | ConvertFrom-Json
    if ($azAccount) {
        Write-Host "  Logged into Azure Subscription: $($azAccount.name) ($($azAccount.id))" -ForegroundColor Green
        Write-Host "  Tenant ID: $($azAccount.tenantId)" -ForegroundColor Green
    } else {
        Write-Host "  Not currently logged into Azure CLI." -ForegroundColor DarkYellow
        Write-Host "  Tip: Run 'az login' in your terminal to sign in with your browser." -ForegroundColor DarkGray
    }
} else {
    Write-Host "  Azure CLI is not installed (optional). You can use .env.azure instead." -ForegroundColor DarkYellow
}

# Step 3: Run Diagnostic
Write-Host "[3/3] Running Azure ChaosGuard Connection Diagnostic..." -ForegroundColor Yellow
python backend_python/azure_connector.py

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " To connect your Azure account later, you have 2 options:" -ForegroundColor White
Write-Host "   Option A (Easiest): Run 'az login' in your command prompt." -ForegroundColor White
Write-Host "   Option B (CI/CD):   Fill in your credentials in '.env.azure'." -ForegroundColor White
Write-Host "======================================================================" -ForegroundColor Cyan
