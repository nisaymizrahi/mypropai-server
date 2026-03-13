const Lease = require('../models/Lease');
const Tenant = require('../models/Tenant');
const Expense = require('../models/Expense');
const ProjectTask = require('../models/ProjectTask');
const {
    fetchPropertyGroupsForUser,
    buildPropertyRecord,
} = require('../utils/propertyWorkspace');

// @desc    Get aggregated summary data for the main dashboard
exports.getSummary = async (req, res) => {
    try {
        const userId = req.user.id;

        // --- Fetch all necessary data in parallel ---
        const [
            propertyGroups,
            tenants,
            recentExpenses,
            upcomingTasks
        ] = await Promise.all([
            fetchPropertyGroupsForUser(userId),
            Tenant.find({ user: userId }).select('_id'),
            Expense.find({ user: userId }).sort({ date: -1 }).limit(5),
            ProjectTask.find({ user: userId, status: { $ne: 'Complete' } }).sort({ endDate: 1 }).limit(3)
        ]);

        // --- Perform Calculations ---
        const propertyRecords = propertyGroups.map(buildPropertyRecord);
        const investments = propertyGroups.flatMap((group) => group.investments || []);
        const managedProperties = propertyGroups.flatMap((group) => group.managedProperties || []);

        const workspaceCounts = {
            pipeline: propertyRecords.filter((property) => property.workspaces.pipeline).length,
            acquisitions: propertyRecords.filter((property) => property.workspaces.acquisitions).length,
            management: propertyRecords.filter((property) => property.workspaces.management).length,
        };
        const totalProperties = propertyRecords.length;
        const standaloneProperties = propertyRecords.filter(
            (property) =>
                !property.workspaces.pipeline &&
                !property.workspaces.acquisitions &&
                !property.workspaces.management
        ).length;
        const propertiesWithWorkspace = totalProperties - standaloneProperties;
        const activeWorkspaces =
            workspaceCounts.pipeline + workspaceCounts.acquisitions + workspaceCounts.management;
        const workspaceCoverageRate = totalProperties > 0
            ? (propertiesWithWorkspace / totalProperties) * 100
            : 0;

        // Portfolio Value
        const totalPortfolioValue = investments.reduce((sum, inv) => sum + (inv.arv || inv.purchasePrice || 0), 0);

        // Occupancy & Rent
        const tenantIds = tenants.map(t => t._id);
        const activeLeases = await Lease.find({ tenant: { $in: tenantIds }, isActive: true });
        const grossMonthlyRent = activeLeases.reduce((sum, lease) => sum + lease.rentAmount, 0);
        
        let totalUnits = 0;
        managedProperties.forEach(prop => {
            totalUnits += Array.isArray(prop.units) ? prop.units.length : 0;
        });
        const occupancyRate = totalUnits > 0 ? (activeLeases.length / totalUnits) * 100 : 0;
        const vacantUnits = Math.max(totalUnits - activeLeases.length, 0);


        // --- Assemble Response ---
        const summary = {
            kpis: {
                portfolioValue: totalPortfolioValue,
                occupancyRate: occupancyRate,
                monthlyRent: grossMonthlyRent,
                activeProjects: workspaceCounts.acquisitions,
                totalProperties,
                activeWorkspaces,
                standaloneProperties,
                workspaceCoverageRate,
                pipelineProperties: workspaceCounts.pipeline,
                acquisitionProperties: workspaceCounts.acquisitions,
                managedProperties: workspaceCounts.management,
                vacantUnits,
            },
            propertyHub: {
                totalProperties,
                standaloneProperties,
                propertiesWithWorkspace,
                activeWorkspaces,
                workspaceCoverageRate,
                workspaceCounts,
            },
            recentActivity: {
                expenses: recentExpenses,
            },
            actionItems: {
                tasks: upcomingTasks,
            }
        };

        res.json(summary);

    } catch (error) {
        console.error("Error fetching dashboard summary:", error);
        res.status(500).json({ msg: "Server Error" });
    }
};
