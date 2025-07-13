const ProjectTask = require('../models/ProjectTask');
const Investment = require('../models/Investment');

// @desc    Create a new project task
exports.createTask = async (req, res) => {
    try {
        const { investmentId, title, startDate, endDate, status, assignee, dependencies } = req.body;

        if (!investmentId || !title || !startDate || !endDate) {
            return res.status(400).json({ msg: 'Please provide all required fields for the task.' });
        }

        // Verify the parent investment exists and belongs to the user
        const investment = await Investment.findById(investmentId);
        if (!investment || investment.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized for this investment.' });
        }

        const newTask = new ProjectTask({
            investment: investmentId,
            user: req.user.id,
            title,
            startDate,
            endDate,
            status,
            assignee,
            dependencies
        });

        await newTask.save();
        res.status(201).json(newTask);

    } catch (error) {
        console.error('Error creating project task:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all tasks for a specific investment
exports.getTasksForInvestment = async (req, res) => {
    try {
        const { investmentId } = req.params;

        // Verify the parent investment exists and belongs to the user
        const investment = await Investment.findById(investmentId);
        if (!investment || investment.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized to view this investment.' });
        }
        
        const tasks = await ProjectTask.find({ investment: investmentId })
            .populate('assignee', 'name trade') // Populate vendor name/trade
            .sort({ startDate: 1 });
            
        res.json(tasks);

    } catch (error) {
        console.error('Error fetching project tasks:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update a project task
exports.updateTask = async (req, res) => {
    try {
        const task = await ProjectTask.findById(req.params.id);

        if (!task) {
            return res.status(404).json({ msg: 'Task not found.' });
        }

        if (task.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        const { title, startDate, endDate, status, assignee, dependencies } = req.body;
        if(title) task.title = title;
        if(startDate) task.startDate = startDate;
        if(endDate) task.endDate = endDate;
        if(status) task.status = status;
        if(assignee) task.assignee = assignee;
        if(dependencies) task.dependencies = dependencies;

        await task.save();
        res.json(task);
        
    } catch (error) {
        console.error('Error updating project task:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a project task
exports.deleteTask = async (req, res) => {
    try {
        const task = await ProjectTask.findById(req.params.id);

        if (!task) {
            return res.status(404).json({ msg: 'Task not found.' });
        }

        if (task.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        // Before deleting, remove this task from any other task's dependency list
        await ProjectTask.updateMany(
            { dependencies: req.params.id },
            { $pull: { dependencies: req.params.id } }
        );
        
        await task.deleteOne();

        res.json({ msg: 'Task removed.' });

    } catch (error) {
        console.error('Error deleting project task:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};