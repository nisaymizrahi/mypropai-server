const mongoose = require("mongoose");
const { Schema } = mongoose;

// --- Sub-documents for the Management System ---

const transactionSchema = new Schema({
    type: { type: String, enum: ['income', 'expense'], required: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    isPaid: { type: Boolean, default: false },
    paidDate: { type: Date },
});

const leaseSchema = new Schema({
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    monthlyRent: { type: Number, required: true },
    securityDeposit: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    leaseDocumentUrl: { type: String },
    transactions: [transactionSchema]
});

const tenantSchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    managedProperty: { type: Schema.Types.ObjectId, ref: 'ManagedProperty', required: true },
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
    leases: [{ type: Schema.Types.ObjectId, ref: 'Lease' }]
});

const unitSchema = new Schema({
    name: { type: String, required: true, default: 'Main Unit' }, // e.g., "Unit A", "Apt 101"
    sqft: { type: Number },
    bedrooms: { type: Number },
    bathrooms: { type: Number },
    currentLease: { type: Schema.Types.ObjectId, ref: 'Lease' }
});

const maintenanceTicketSchema = new Schema({
    description: { type: String, required: true },
    status: { type: String, enum: ['Open', 'In Progress', 'Completed'], default: 'Open' },
    reportedDate: { type: Date, default: Date.now },
    completedDate: { type: Date },
    cost: { type: Number },
    vendor: { type: String },
    invoiceUrl: { type: String }
});

const operatingExpenseSchema = new Schema({
    description: { type: String, required: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    isRecurring: { type: Boolean, default: false },
    receiptUrl: { type: String }
});

// --- Main ManagedProperty Model ---

const managedPropertySchema = new Schema({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    investment: { type: Schema.Types.ObjectId, ref: 'Investment', required: true },
    address: { type: String, required: true },
    
    units: [unitSchema],
    tenants: [{ type: Schema.Types.ObjectId, ref: 'Tenant' }],
    operatingExpenses: [operatingExpenseSchema],
    maintenanceTickets: [maintenanceTicketSchema]
}, { timestamps: true });


const ManagedProperty = mongoose.model("ManagedProperty", managedPropertySchema);
const Unit = mongoose.model("Unit", unitSchema);
const Tenant = mongoose.model("Tenant", tenantSchema);
const Lease = mongoose.model("Lease", leaseSchema);

module.exports = { ManagedProperty, Unit, Tenant, Lease };
