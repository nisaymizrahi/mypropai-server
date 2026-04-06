const ProjectDocument = require('../models/ProjectDocument');
const Investment = require('../models/Investment');
const DocumentAsset = require('../models/DocumentAsset');
const {
    createDocumentAsset,
    deleteCloudinaryAsset,
    DocumentStorageError,
    markDocumentAssetLinked,
    releaseUsage,
    rollbackDocumentAssetCreation,
} = require('../utils/documentStorageService');

const LEGACY_PRIMARY_FUNDING_SOURCE_ID = 'legacy-primary-funding-source';

const toOptionalString = (value) => String(value || '').trim();

const findFundingSource = (investment, sourceId) => {
    if (!sourceId) {
        return null;
    }

    if (
        sourceId === LEGACY_PRIMARY_FUNDING_SOURCE_ID &&
        (!Array.isArray(investment?.fundingSources) || investment.fundingSources.length === 0) &&
        (Number(investment?.loanAmount || 0) > 0 ||
            toOptionalString(investment?.loanType) ||
            toOptionalString(investment?.lenderName))
    ) {
        return {
            sourceId: LEGACY_PRIMARY_FUNDING_SOURCE_ID,
            name: toOptionalString(investment?.lenderName),
            type: toOptionalString(investment?.loanType),
        };
    }

    return (
        investment?.fundingSources?.find(
            (source) => String(source?.sourceId || '') === String(sourceId)
        ) || null
    );
};

const findDrawRequest = (investment, drawRequestId) => {
    if (!drawRequestId) {
        return null;
    }

    return (
        investment?.drawRequests?.find(
            (request) => String(request?.drawId || '') === String(drawRequestId)
        ) || null
    );
};

const resolveFinanceLink = ({ investment, fundingSourceId, drawRequestId }) => {
    const nextFundingSourceId = toOptionalString(fundingSourceId);
    const nextDrawRequestId = toOptionalString(drawRequestId);
    const matchedDrawRequest = findDrawRequest(investment, nextDrawRequestId);

    if (nextDrawRequestId && !matchedDrawRequest) {
        return { error: 'Selected draw request was not found for this project.' };
    }

    let resolvedFundingSourceId = nextFundingSourceId;

    if (matchedDrawRequest?.sourceId) {
        const drawSourceId = toOptionalString(matchedDrawRequest.sourceId);

        if (resolvedFundingSourceId && resolvedFundingSourceId !== drawSourceId) {
            return { error: 'Selected draw request does not match the chosen funding source.' };
        }

        resolvedFundingSourceId = drawSourceId;
    }

    if (resolvedFundingSourceId && !findFundingSource(investment, resolvedFundingSourceId)) {
        return { error: 'Selected funding source was not found for this project.' };
    }

    return {
        fundingSourceId: resolvedFundingSourceId,
        drawRequestId: nextDrawRequestId,
    };
};

// @desc    Upload a new document
exports.uploadDocument = async (req, res) => {
    try {
        const { investmentId, displayName, category, fundingSourceId, drawRequestId } = req.body;

        if (!req.file) {
            return res.status(400).json({ msg: 'No file uploaded.' });
        }
        if (!investmentId || !displayName) {
            return res.status(400).json({ msg: 'Investment ID and Display Name are required.' });
        }

        // Verify the parent investment exists and belongs to the user
        const investment = await Investment.findById(investmentId);
        if (!investment || investment.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized for this investment.' });
        }

        const financeLink = resolveFinanceLink({
            investment,
            fundingSourceId,
            drawRequestId,
        });

        if (financeLink.error) {
            return res.status(400).json({ msg: financeLink.error });
        }

        const { asset } = await createDocumentAsset({
            user: req.user,
            file: req.file,
            displayName,
            source: 'project_document',
            documentCategory: category || 'General',
            relatedEntityType: 'investment',
            relatedEntityId: investmentId,
            relatedRefs: {
                investment: investmentId,
            },
        });

        const newDocument = new ProjectDocument({
            investment: investmentId,
            user: req.user.id,
            ownerAccount: req.user.id,
            displayName,
            category,
            fundingSourceId: financeLink.fundingSourceId,
            drawRequestId: financeLink.drawRequestId,
            documentAsset: asset._id,
            fileUrl: asset.secureUrl,
            cloudinaryId: asset.publicId,
            secureUrl: asset.secureUrl,
            cloudinaryAssetId: asset.assetId,
            resourceType: asset.resourceType,
            deliveryType: asset.deliveryType,
            fileBytes: asset.bytes,
            originalFilename: asset.originalFilename,
            mimeType: asset.mimeType,
            cloudinaryVersion: asset.version,
            cloudinaryFormat: asset.format,
        });

        try {
            await newDocument.save();
        } catch (saveError) {
            await rollbackDocumentAssetCreation({
                assetId: asset._id,
                userId: req.user.id,
                bytes: asset.bytes,
            }).catch(() => null);
            throw saveError;
        }

        await markDocumentAssetLinked({
            assetId: asset._id,
            sourceRecordId: newDocument._id,
        }).catch((linkError) => {
            console.error('Project document asset link update failed:', linkError);
        });

        res.status(201).json(newDocument);

    } catch (error) {
        if (error instanceof DocumentStorageError) {
            return res.status(error.status).json({ msg: error.message, code: error.code });
        }
        console.error('Error uploading document:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all documents for a specific investment
exports.getDocumentsForInvestment = async (req, res) => {
    try {
        const { investmentId } = req.params;

        // Verify ownership
        const investment = await Investment.findById(investmentId);
        if (!investment || investment.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized to view these documents.' });
        }
        
        const documents = await ProjectDocument.find({ investment: investmentId }).sort({ createdAt: -1 });
        res.json(documents);

    } catch (error) {
        console.error('Error fetching documents:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a document
exports.deleteDocument = async (req, res) => {
    try {
        const document = await ProjectDocument.findById(req.params.id);

        if (!document) {
            return res.status(404).json({ msg: 'Document not found.' });
        }

        // Check ownership
        if (document.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        const asset = document.documentAsset
            ? await DocumentAsset.findById(document.documentAsset)
            : null;

        await deleteCloudinaryAsset({
            publicId: asset?.publicId || document.cloudinaryId,
            resourceType: asset?.resourceType || document.resourceType || 'raw',
            deliveryType: asset?.deliveryType || document.deliveryType || 'authenticated',
        });

        await document.deleteOne();
        if (asset) {
            await DocumentAsset.deleteOne({ _id: asset._id });
            await releaseUsage({
                userId: document.ownerAccount || document.user,
                bytes: asset.bytes,
            });
        } else if (document.fileBytes) {
            await releaseUsage({
                userId: document.ownerAccount || document.user,
                bytes: document.fileBytes,
            });
        }

        res.json({ msg: 'Document removed successfully.' });

    } catch (error) {
        if (error instanceof DocumentStorageError) {
            return res.status(error.status).json({ msg: error.message, code: error.code });
        }
        console.error('Error deleting document:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};
