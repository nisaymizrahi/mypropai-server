const TenantUser = require('../models/TenantUser');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// @desc    Allow a tenant to set their password using an invitation token
exports.setTenantPassword = async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
        return res.status(400).json({ msg: 'Password must be at least 6 characters long.' });
    }

    try {
        // Find the user by the invitation token and ensure it has not expired
        const tenantUser = await TenantUser.findOne({
            invitationToken: token,
            invitationExpires: { $gt: Date.now() },
        });

        if (!tenantUser) {
            return res.status(400).json({ msg: 'Invitation token is invalid or has expired.' });
        }

        // Set the new password
        tenantUser.password = password;
        // Clear the invitation token fields
        tenantUser.invitationToken = undefined;
        tenantUser.invitationExpires = undefined;

        await tenantUser.save();

        res.status(200).json({ msg: 'Password has been set successfully. You can now log in.' });

    } catch (err) {
        console.error('Error setting tenant password:', err);
        res.status(500).json({ msg: 'Server error.' });
    }
};


// @desc    Authenticate a tenant and get a token
exports.loginTenant = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ msg: 'Please provide an email and password.' });
    }

    try {
        const tenantUser = await TenantUser.findOne({ email }).select('+password');

        if (!tenantUser || !tenantUser.password) {
            return res.status(401).json({ msg: 'Invalid credentials or account not yet activated.' });
        }

        const isMatch = await tenantUser.comparePassword(password);

        if (!isMatch) {
            return res.status(401).json({ msg: 'Invalid credentials.' });
        }
        
        // Create JWT payload
        const payload = {
            id: tenantUser._id, // The ID of the TenantUser document
            tenantInfoId: tenantUser.tenantInfo, // The ID of the main Tenant document
            isTenant: true, // A flag to identify this as a tenant token
        };

        // Sign the token
        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(200).json({ token });

    } catch (err) {
        console.error('Error logging in tenant:', err);
        res.status(500).json({ msg: 'Server error.' });
    }
};