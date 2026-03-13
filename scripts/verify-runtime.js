const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
process.env.SKIP_REDIS_CONNECT = '1';

const modelModules = [
  './models/User',
  './models/Property',
  './models/Investment',
  './models/ManagedProperty',
  './models/Unit',
  './models/Tenant',
  './models/Lease',
  './models/OperatingExpense',
  './models/TenantUser',
  './models/BudgetItem',
  './models/Expense',
  './models/Vendor',
  './models/ProjectTask',
  './models/ProjectDocument',
  './models/MaintenanceTicket',
  './models/Inspection',
  './models/Lead',
  './models/Bid',
  './models/Application',
  './models/Purchase',
];

const routeModules = [
  './routes/investments',
  './routes/auth',
  './routes/comps',
  './routes/uploads',
  './routes/management',
  './routes/tenantAuthRoutes',
  './routes/tenantRoutes',
  './routes/budgetItemRoutes',
  './routes/expenseRoutes',
  './routes/vendorRoutes',
  './routes/projectTaskRoutes',
  './routes/documentRoutes',
  './routes/unitDocumentRoutes',
  './routes/dashboardRoutes',
  './routes/maintenanceRoutes',
  './routes/operatingExpenseRoutes',
  './routes/inspectionRoutes',
  './routes/aiToolsRoutes',
  './routes/leadRoutes',
  './routes/stripeRoutes',
  './routes/bidRoutes',
  './routes/notifications',
  './routes/billingRoutes',
  './routes/properties',
  './routes/platformManagerRoutes',
  './routes/applicationRoutes',
];

const requireFromRoot = (relativeModulePath) =>
  require(path.join(projectRoot, relativeModulePath));

const verifyModules = (modules, type) => {
  for (const modulePath of modules) {
    try {
      requireFromRoot(modulePath);
    } catch (error) {
      const isMissingModule = error?.code === 'MODULE_NOT_FOUND';
      const matchesRequestedPath =
        error?.message?.includes(`'${modulePath}'`) ||
        error?.message?.includes(`"${modulePath}"`);

      if (isMissingModule && matchesRequestedPath) {
        console.error(`[verify-runtime] Missing ${type} module: ${modulePath}`);
      } else {
        console.error(`[verify-runtime] Failed while loading ${modulePath}`);
      }

      throw error;
    }
  }
};

try {
  verifyModules(modelModules, 'model');
  verifyModules(routeModules, 'route');
  console.log('[verify-runtime] Runtime imports verified.');
} catch (error) {
  process.exitCode = 1;
}
