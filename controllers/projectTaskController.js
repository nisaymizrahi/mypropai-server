const ProjectTask = require('../models/ProjectTask');
const Investment = require('../models/Investment');
const BudgetItem = require('../models/BudgetItem');

// Utility to update investment progress
const updateInvestmentProgress = async (investmentId) => {
  const tasks = await ProjectTask.find({ investment: investmentId });
  const completed = tasks.filter((task) => task.status === 'Complete').length;
  const progress = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
  await Investment.findByIdAndUpdate(investmentId, { progress });
};

const getAuthorizedInvestment = async (investmentId, userId) => {
  const investment = await Investment.findById(investmentId);
  if (!investment || investment.user.toString() !== userId) {
    return null;
  }
  return investment;
};

const getAuthorizedTask = async (taskId, userId) => {
  const task = await ProjectTask.findById(taskId);

  if (!task) {
    return { error: { status: 404, msg: 'Task not found.' } };
  }

  const investment = await getAuthorizedInvestment(task.investment, userId);
  if (!investment) {
    return { error: { status: 401, msg: 'Unauthorized' } };
  }

  return { task, investment };
};

const getAuthorizedBudgetItem = async (budgetItemId, investmentId, userId) => {
  if (!budgetItemId) {
    return null;
  }

  const budgetItem = await BudgetItem.findById(budgetItemId);
  if (
    !budgetItem ||
    String(budgetItem.user) !== String(userId) ||
    String(budgetItem.investment) !== String(investmentId)
  ) {
    return null;
  }

  return budgetItem;
};

const normalizeSubtasks = (subtasks) =>
  Array.isArray(subtasks)
    ? subtasks
        .filter((subtask) => subtask?.title)
        .map((subtask) => ({
          title: subtask.title,
          done: Boolean(subtask.done),
        }))
    : [];

// @desc    Create a new project task
exports.createTask = async (req, res) => {
  try {
    const {
      investmentId,
      title,
      description,
      startDate,
      endDate,
      status,
      assignee,
      budgetItemId,
      type,
      phase,
      reminderOn,
      dependencies,
      subtasks,
    } = req.body;

    if (!investmentId || !title || !startDate || !endDate) {
      return res.status(400).json({ msg: 'Please provide all required fields for the task.' });
    }

    const investment = await getAuthorizedInvestment(investmentId, req.user.id);
    if (!investment) {
      return res.status(401).json({ msg: 'Not authorized for this investment.' });
    }

    const budgetItem = await getAuthorizedBudgetItem(budgetItemId, investmentId, req.user.id);
    if (budgetItemId && !budgetItem) {
      return res.status(400).json({ msg: 'Selected scope item was not found for this project.' });
    }

    const newTask = new ProjectTask({
      investment: investmentId,
      budgetItem: budgetItem?._id || null,
      title,
      description: description || '',
      startDate,
      endDate,
      status: status || 'Not Started',
      assignee: assignee || undefined,
      type: type || 'vendor',
      phase: phase || '',
      reminderOn: reminderOn || undefined,
      dependencies: Array.isArray(dependencies) ? dependencies : [],
      subtasks: normalizeSubtasks(subtasks),
    });

    await newTask.save();
    await updateInvestmentProgress(investmentId);
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
    const investment = await getAuthorizedInvestment(investmentId, req.user.id);
    if (!investment) {
      return res.status(401).json({ msg: 'Not authorized to view this investment.' });
    }

    const tasks = await ProjectTask.find({ investment: investmentId })
      .populate('assignee', 'name trade')
      .populate('budgetItem', 'category scopeKey scopeGroup description')
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
    const { task, error } = await getAuthorizedTask(req.params.id, req.user.id);
    if (error) {
      return res.status(error.status).json({ msg: error.msg });
    }

    const {
      title,
      description,
      startDate,
      endDate,
      status,
      assignee,
      budgetItemId,
      type,
      phase,
      reminderOn,
      dependencies,
      subtasks,
    } = req.body;

    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (startDate !== undefined) task.startDate = startDate;
    if (endDate !== undefined) task.endDate = endDate;
    if (status !== undefined) task.status = status;
    if (assignee !== undefined) task.assignee = assignee || undefined;
    if (budgetItemId !== undefined) {
      const budgetItem = await getAuthorizedBudgetItem(
        budgetItemId,
        String(task.investment),
        req.user.id
      );
      if (budgetItemId && !budgetItem) {
        return res.status(400).json({ msg: 'Selected scope item was not found for this project.' });
      }
      task.budgetItem = budgetItem?._id || null;
    }
    if (type !== undefined) task.type = type;
    if (phase !== undefined) task.phase = phase;
    if (reminderOn !== undefined) task.reminderOn = reminderOn || undefined;
    if (dependencies !== undefined) {
      task.dependencies = Array.isArray(dependencies) ? dependencies : [];
    }
    if (subtasks !== undefined) {
      task.subtasks = normalizeSubtasks(subtasks);
    }

    await task.save();
    await updateInvestmentProgress(task.investment);
    res.json(task);
  } catch (error) {
    console.error('Error updating project task:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Delete a project task
exports.deleteTask = async (req, res) => {
  try {
    const { task, error } = await getAuthorizedTask(req.params.id, req.user.id);
    if (error) {
      return res.status(error.status).json({ msg: error.msg });
    }

    await ProjectTask.updateMany(
      { dependencies: req.params.id },
      { $pull: { dependencies: req.params.id } }
    );

    const investmentId = task.investment;
    await task.deleteOne();
    await updateInvestmentProgress(investmentId);

    res.json({ msg: 'Task removed.' });
  } catch (error) {
    console.error('Error deleting project task:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};
