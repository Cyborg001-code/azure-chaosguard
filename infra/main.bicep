// Azure ChaosGuard - Master Cloud Infrastructure (Bicep)
// Deploys Multi-Service Container Apps, Cosmos DB, Redis Cache, SignalR, and Application Insights

@description('Azure Region for primary deployment')
param location string = resourceGroup().location

@description('Environment name prefix')
param environmentName string = 'chaosguard-prod'

// 1. Log Analytics & Application Insights
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${environmentName}-law'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${environmentName}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// 2. Azure SignalR Service (Real-time WebSockets)
resource signalR 'Microsoft.SignalRService/signalR@2023-02-01' = {
  name: '${environmentName}-signalr'
  location: location
  sku: {
    name: 'Standard_S1'
    capacity: 1
  }
  properties: {
    features: [
      {
        flag: 'ServiceMode'
        value: 'Default'
      }
    ]
    cors: {
      allowedOrigins: ['*']
    }
  }
}

// 3. Azure Cosmos DB (Primary database under test)
resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts@2023-04-15' = {
  name: '${environmentName}-cosmos'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
  }
}

// 4. Azure Cache for Redis (Circuit Breaker Fallback Cache)
resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: '${environmentName}-redis'
  location: location
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0
    }
    enableNonSslPort: false
  }
}

// 5. Container Apps Environment
resource containerEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${environmentName}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// Outputs
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output signalRHostName string = signalR.properties.hostName
output cosmosEndpoint string = cosmosDb.properties.documentEndpoint
