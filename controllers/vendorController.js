const Vendor = require('../models/Vendor');
const Expense = require('../models/Expense');
const DocumentAsset = require('../models/DocumentAsset');
const {
    createDocumentAsset,
    deleteCloudinaryAsset,
    DocumentStorageError,
    markDocumentAssetLinked,
    releaseUsage,
    rollbackDocumentAssetCreation,
} = require('../utils/documentStorageService');

const allowedStatuses = new Set(['active', 'preferred', 'not_assignable', 'inactive']);

const normalizeString = (value) => {
    if (value === undefined || value === null) {
        return undefined;
    }

    const normalized = String(value).trim();
    return normalized;
};

const normalizeOptionalString = (value) => {
    const normalized = normalizeString(value);
    return normalized === undefined ? undefined : normalized;
};

const normalizeArray = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }

    return [...new Set(
        value
            .map((item) => normalizeString(item))
            .filter(Boolean)
    )];
};

const normalizeDate = (value) => {
    if (!value) {
        return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeStatus = (value, fallback = 'active') => {
    const normalized = normalizeString(value)?.toLowerCase();
    return allowedStatuses.has(normalized) ? normalized : fallback;
};

const buildContactInfo = (contactInfo = {}, base = {}) => ({
    contactName: normalizeOptionalString(contactInfo.contactName) || base.contactName || '',
    email: normalizeOptionalString(contactInfo.email) || base.email || '',
    phone: normalizeOptionalString(contactInfo.phone) || base.phone || '',
    address: normalizeOptionalString(contactInfo.address) || base.address || '',
});

const applyVendorPayload = (vendor, payload = {}) => {
    const specialties = normalizeArray(payload.specialties);
    const nextTrade = normalizeOptionalString(payload.trade) || specialties[0] || vendor.trade;
    const nextStatus = payload.status !== undefined
        ? normalizeStatus(payload.status, vendor.status || 'active')
        : vendor.status || 'active';

    if (payload.name !== undefined) vendor.name = normalizeOptionalString(payload.name) || vendor.name;
    if (payload.trade !== undefined || payload.specialties !== undefined) vendor.trade = nextTrade;
    if (payload.specialties !== undefined) vendor.specialties = specialties;
    if (payload.description !== undefined) vendor.description = normalizeOptionalString(payload.description) || '';
    if (payload.notes !== undefined) vendor.notes = normalizeOptionalString(payload.notes) || '';
    if (payload.contactInfo !== undefined) {
        vendor.contactInfo = buildContactInfo(payload.contactInfo, vendor.contactInfo || {});
    }
    if (payload.serviceArea !== undefined) vendor.serviceArea = normalizeOptionalString(payload.serviceArea) || '';
    if (payload.afterHoursAvailable !== undefined) vendor.afterHoursAvailable = Boolean(payload.afterHoursAvailable);
    if (payload.status !== undefined) vendor.status = nextStatus;
    if (payload.isActive !== undefined && payload.status === undefined) {
        vendor.isActive = Boolean(payload.isActive);
        vendor.status = vendor.isActive ? (vendor.status === 'inactive' ? 'active' : vendor.status) : 'inactive';
    } else {
        vendor.isActive = nextStatus !== 'inactive';
    }

    const compliance = payload.compliance;
    if (compliance !== undefined && compliance && typeof compliance === 'object') {
        vendor.compliance = {
            w9_url: normalizeOptionalString(compliance.w9_url) || vendor.compliance?.w9_url || undefined,
            insurance_url: normalizeOptionalString(compliance.insurance_url) || vendor.compliance?.insurance_url || undefined,
            insurance_expiration_date:
                normalizeDate(compliance.insurance_expiration_date) ||
                vendor.compliance?.insurance_expiration_date ||
                undefined,
        };
    }
};

const getAuthorizedVendor = async (vendorId, userId) => {
    const vendor = await Vendor.findById(vendorId);

    if (!vendor) {
        return { error: { status: 404, msg: 'Vendor not found.' } };
    }

    if (vendor.user.toString() !== userId) {
        return { error: { status: 401, msg: 'User not authorized.' } };
    }

    return { vendor };
};

// @desc    Create a new vendor
exports.createVendor = async (req, res) => {
    try {
        const specialties = normalizeArray(req.body.specialties);
        const name = normalizeOptionalString(req.body.name);
        const trade = normalizeOptionalString(req.body.trade) || specialties[0];

        if (!name || !trade) {
            return res.status(400).json({ msg: 'Please provide a name and trade for the vendor.' });
        }

        const newVendor = new Vendor({
            user: req.user.id,
            name,
            trade,
            specialties,
            description: normalizeOptionalString(req.body.description) || '',
            contactInfo: buildContactInfo(req.body.contactInfo),
            serviceArea: normalizeOptionalString(req.body.serviceArea) || '',
            notes: normalizeOptionalString(req.body.notes) || '',
            status: normalizeStatus(req.body.status),
            afterHoursAvailable: Boolean(req.body.afterHoursAvailable),
        });

        newVendor.isActive = newVendor.status !== 'inactive';

        await newVendor.save();
        res.status(201).json(newVendor);

    } catch (error) {
        // Handle potential duplicate name error
        if (error.code === 11000) {
            return res.status(400).json({ msg: 'A vendor with this name already exists.' });
        }
        console.error('Error creating vendor:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all of a user's vendors
exports.getVendors = async (req, res) => {
    try {
        const vendors = await Vendor.find({ user: req.user.id }).sort({ name: 1 });
        res.json(vendors);
    } catch (error) {
        console.error('Error fetching vendors:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get one vendor
exports.getVendorById = async (req, res) => {
    try {
        const { vendor, error } = await getAuthorizedVendor(req.params.id, req.user.id);

        if (error) {
            return res.status(error.status).json({ msg: error.msg });
        }

        res.json(vendor);
    } catch (error) {
        console.error('Error fetching vendor details:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update a vendor
exports.updateVendor = async (req, res) => {
    try {
        const { vendor, error } = await getAuthorizedVendor(req.params.id, req.user.id);

        if (error) {
            return res.status(error.status).json({ msg: error.msg });
        }

        applyVendorPayload(vendor, req.body);

        await vendor.save();
        res.json(vendor);

    } catch (error) {
        console.error('Error updating vendor:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a vendor
exports.deleteVendor = async (req, res) => {
    try {
        const { vendor, error } = await getAuthorizedVendor(req.params.id, req.user.id);

        if (error) {
            return res.status(error.status).json({ msg: error.msg });
        }

        // Before deleting the vendor, unlink them from any expenses.
        // This prevents data issues and keeps historical expense records intact.
        await Expense.updateMany({ vendor: req.params.id }, { $set: { vendor: null } });

        for (const document of vendor.documents || []) {
            const asset = document.documentAsset
                ? await DocumentAsset.findById(document.documentAsset).catch(() => null)
                : null;

            await deleteCloudinaryAsset({
                publicId: asset?.publicId || document.cloudinaryId,
                resourceType: asset?.resourceType || document.resourceType || 'raw',
                deliveryType: asset?.deliveryType || document.deliveryType || 'authenticated',
            }).catch(() => null);

            if (asset) {
                await DocumentAsset.deleteOne({ _id: asset._id }).catch(() => null);
                await releaseUsage({
                    userId: asset.ownerAccount || vendor.user,
                    bytes: asset.bytes,
                }).catch(() => null);
            } else if (document.fileBytes) {
                await releaseUsage({
                    userId: document.ownerAccount || vendor.user,
                    bytes: document.fileBytes,
                }).catch(() => null);
            }
        }

        await vendor.deleteOne();

        res.json({ msg: 'Vendor removed.' });

    } catch (error) {
        if (error instanceof DocumentStorageError) {
            return res.status(error.status).json({ msg: error.message, code: error.code });
        }
        console.error('Error deleting vendor:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Upload a vendor document
exports.uploadVendorDocument = async (req, res) => {
    try {
        const { vendor, error } = await getAuthorizedVendor(req.params.id, req.user.id);

        if (error) {
            return res.status(error.status).json({ msg: error.msg });
        }

        if (!req.file) {
            return res.status(400).json({ msg: 'No file uploaded.' });
        }

        const displayName = normalizeOptionalString(req.body.displayName);
        if (!displayName) {
            return res.status(400).json({ msg: 'Document name is required.' });
        }

        const { asset } = await createDocumentAsset({
            user: req.user,
            file: req.file,
            displayName,
            source: 'vendor_document',
            documentCategory: normalizeOptionalString(req.body.category) || 'Other',
            relatedEntityType: 'vendor',
            relatedEntityId: req.params.id,
            relatedRefs: {
                vendor: vendor._id,
            },
        });

        const nextDocument = {
            displayName,
            category: normalizeOptionalString(req.body.category) || 'Other',
            fileUrl: asset.secureUrl,
            cloudinaryId: asset.publicId,
            documentAsset: asset._id,
            ownerAccount: req.user.id,
            secureUrl: asset.secureUrl,
            cloudinaryAssetId: asset.assetId,
            resourceType: asset.resourceType,
            deliveryType: asset.deliveryType,
            fileBytes: asset.bytes,
            originalFilename: asset.originalFilename,
            mimeType: asset.mimeType,
            cloudinaryVersion: asset.version,
            cloudinaryFormat: asset.format,
            issueDate: normalizeDate(req.body.issueDate),
            expiresAt: normalizeDate(req.body.expiresAt),
            notes: normalizeOptionalString(req.body.notes) || '',
            uploadedAt: new Date(),
        };

        vendor.documents.push(nextDocument);

        const lowerCategory = nextDocument.category.toLowerCase();
        if (lowerCategory === 'w-9') {
            vendor.compliance = {
                ...(vendor.compliance?.toObject ? vendor.compliance.toObject() : vendor.compliance),
                w9_url: nextDocument.fileUrl,
            };
        }

        if (
            lowerCategory.includes('insurance') ||
            lowerCategory === 'certificate of insurance'
        ) {
            vendor.compliance = {
                ...(vendor.compliance?.toObject ? vendor.compliance.toObject() : vendor.compliance),
                insurance_url: nextDocument.fileUrl,
                insurance_expiration_date:
                    nextDocument.expiresAt ||
                    vendor.compliance?.insurance_expiration_date ||
                    undefined,
            };
        }

        try {
            await vendor.save();
        } catch (saveError) {
            await rollbackDocumentAssetCreation({
                assetId: asset._id,
                userId: req.user.id,
                bytes: asset.bytes,
            }).catch(() => null);
            throw saveError;
        }

        const createdDocument = vendor.documents[vendor.documents.length - 1];
        await markDocumentAssetLinked({
            assetId: asset._id,
            sourceRecordId: createdDocument?._id,
        }).catch((linkError) => {
            console.error('Vendor document asset link update failed:', linkError);
        });

        res.status(201).json(vendor);
    } catch (error) {
        if (error instanceof DocumentStorageError) {
            return res.status(error.status).json({ msg: error.message, code: error.code });
        }
        console.error('Error uploading vendor document:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a vendor document
exports.deleteVendorDocument = async (req, res) => {
    try {
        const { vendor, error } = await getAuthorizedVendor(req.params.id, req.user.id);

        if (error) {
            return res.status(error.status).json({ msg: error.msg });
        }

        const document = vendor.documents.id(req.params.documentId);
        if (!document) {
            return res.status(404).json({ msg: 'Document not found.' });
        }

        const asset = document.documentAsset
            ? await DocumentAsset.findById(document.documentAsset).catch(() => null)
            : null;

        await deleteCloudinaryAsset({
            publicId: asset?.publicId || document.cloudinaryId,
            resourceType: asset?.resourceType || document.resourceType || 'raw',
            deliveryType: asset?.deliveryType || document.deliveryType || 'authenticated',
        }).catch(() => null);
        document.deleteOne();
        await vendor.save();
        if (asset) {
            await DocumentAsset.deleteOne({ _id: asset._id }).catch(() => null);
            await releaseUsage({
                userId: asset.ownerAccount || vendor.user,
                bytes: asset.bytes,
            }).catch(() => null);
        } else if (document.fileBytes) {
            await releaseUsage({
                userId: document.ownerAccount || vendor.user,
                bytes: document.fileBytes,
            }).catch(() => null);
        }

        res.json(vendor);
    } catch (error) {
        if (error instanceof DocumentStorageError) {
            return res.status(error.status).json({ msg: error.message, code: error.code });
        }
        console.error('Error deleting vendor document:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};
