const TenantUser = require('../models/TenantUser');
const { verifyJwt } = require('../utils/jwtConfig');

const requireTenantAuth = async (req, res, next) => {
    // 1. Get the token from the 'authorization' header
    const { authorization } = req.headers;

    if (!authorization || !authorization.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization token required.' });
    }

    const token = authorization.split(' ')[1];

    try {
        // 2. Verify the token
        const { id } = verifyJwt(token);

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
