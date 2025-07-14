const Investment = require('../models/Investment');
const ManagedProperty = require('../models/ManagedProperty');
const Lease = require('../models/Lease');
const Tenant = require('../models/Tenant');
const Expense = require('../models/Expense');
const ProjectTask = require('../models/ProjectTask');

// @desc    Get aggregated summary data for the main dashboard
exports.getSummary = async (req, res) => {
    try {
        const userId = req.user.id;

        // --- Fetch all necessary data in parallel ---
        const [
            investments,
            managedProperties,
            tenants,
            recentExpenses,
            upcomingTasks
        ] = await Promise.all([
            Investment.find({ user: userId }),
            ManagedProperty.find({ user: userId }).populate('units'),
            Tenant.find({ user: userId }).select('_id'),
            Expense.find({ user: userId }).sort({ date: -1 }).limit(5),
            ProjectTask.find({ user: userId, status: { $ne: 'Complete' } }).sort({ endDate: 1 }).limit(3)
        ]);

        // --- Perform Calculations ---

        // Portfolio Value
        const totalPortfolioValue = investments.reduce((sum, inv) => sum + (inv.arv || inv.purchasePrice || 0), 0);

        // Occupancy & Rent
        const tenantIds = tenants.map(t => t._id);
        const activeLeases = await Lease.find({ tenant: { $in: tenantIds }, isActive: true });
        const grossMonthlyRent = activeLeases.reduce((sum, lease) => sum + lease.rentAmount, 0);
        
        let totalUnits = 0;
        managedProperties.forEach(prop => {
            totalUnits += prop.units.length;
        });
        const occupancyRate = totalUnits > 0 ? (activeLeases.length / totalUnits) * 100 : 0;


        // --- Assemble Response ---
        const summary = {
            kpis: {
                portfolioValue: totalPortfolioValue,
                occupancyRate: occupancyRate,
                monthlyRent: grossMonthlyRent,
                activeProjects: investments.length, // Simplified for now
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