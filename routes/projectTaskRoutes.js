const express = require('express');
const router = express.Router();
const projectTaskController = require('../controllers/projectTaskController');
const requireAuth = require('../middleware/requireAuth');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/project-tasks
// @desc    Create a new project task
router.post('/', projectTaskController.createTask);

// @route   GET /api/project-tasks/investment/:investmentId
// @desc    Get all tasks for a specific investment
router.get('/investment/:investmentId', projectTaskController.getTasksForInvestment);

// @route   PATCH /api/project-tasks/:id
// @desc    Update a project task
router.patch('/:id', projectTaskController.updateTask);

// @route   DELETE /api/project-tasks/:id
// @desc    Delete a project task
router.delete('/:id', projectTaskController.deleteTask);

module.exports = router;