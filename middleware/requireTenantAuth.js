const jwt = require('jsonwebtoken');
const TenantUser = require('../models/TenantUser');

const requireTenantAuth = async (req, res, next) => {
    // 1. Get the token from the 'authorization' header
    const { authorization } = req.headers;

    if (!authorization) {
        return res.status(401).json({ error: 'Authorization token required.' });
    }

    const token = authorization.split(' ')[1];

    try {
        // 2. Verify the token
        const { id } = jwt.verify(token, process.env.JWT_SECRET);

        // 3. Find the tenant user by id and attach it to the request
        req.tenantUser = await TenantUser.findById(id).select('_id tenantInfo');
        
        if (!req.tenantUser) {
            return res.status(401).json({ error: 'Request is not authorized.' });
        }
        
        next();

    } catch (error) {
        console.error(error);
        res.status(401).json({ error: 'Request is not authorized.' });
    }
};

module.exports = requireTenantAuth;