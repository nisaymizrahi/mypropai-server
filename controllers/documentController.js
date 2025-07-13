const ProjectDocument = require('../models/ProjectDocument');
const Investment = require('../models/Investment');
const cloudinary = require('cloudinary').v2;

// @desc    Upload a new document
exports.uploadDocument = async (req, res) => {
    try {
        const { investmentId, displayName, category } = req.body;

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

        const newDocument = new ProjectDocument({
            investment: investmentId,
            user: req.user.id,
            displayName,
            category,
            fileUrl: req.file.path,
            cloudinaryId: req.file.filename,
        });

        await newDocument.save();
        res.status(201).json(newDocument);

    } catch (error) {
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
        
        // Delete the file from Cloudinary first
        await cloudinary.uploader.destroy(document.cloudinaryId);
        
        // Then delete the record from the database
        await document.deleteOne();

        res.json({ msg: 'Document removed successfully.' });

    } catch (error) {
        console.error('Error deleting document:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};