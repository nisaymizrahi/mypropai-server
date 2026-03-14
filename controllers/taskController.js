const Task = require("../models/Task");

const validUrgencies = new Set(["low", "medium", "high", "critical"]);
const validStatuses = new Set(["open", "in_progress", "blocked", "complete"]);
const validSourceTypes = new Set(["general", "lead", "property", "investment", "management"]);

const normalizeString = (value) => {
  if (value === undefined || value === null) return undefined;
  return String(value).trim();
};

const normalizeDate = (value) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const normalizeUrgency = (value, fallback = "medium") => {
  const normalized = normalizeString(value)?.toLowerCase();
  return validUrgencies.has(normalized) ? normalized : fallback;
};

const normalizeStatus = (value, fallback = "open") => {
  const normalized = normalizeString(value)?.toLowerCase();
  return validStatuses.has(normalized) ? normalized : fallback;
};

const normalizeSourceType = (value, fallback = "general") => {
  const normalized = normalizeString(value)?.toLowerCase();
  return validSourceTypes.has(normalized) ? normalized : fallback;
};

const buildScopeQuery = (query = {}) => {
  const sourceType = normalizeString(query.sourceType);
  const sourceId = normalizeString(query.sourceId);
  const propertyKey = normalizeString(query.propertyKey);
  const match = normalizeString(query.match)?.toLowerCase() === "any" ? "any" : "all";

  const scopeClauses = [];

  if (sourceType && sourceId) {
    scopeClauses.push({ sourceType, sourceId });
  } else if (sourceType) {
    scopeClauses.push({ sourceType });
  }

  if (propertyKey) {
    scopeClauses.push({ propertyKey });
  }

  if (scopeClauses.length === 0) {
    return {};
  }

  if (match === "any" && scopeClauses.length > 1) {
    return { $or: scopeClauses };
  }

  return Object.assign({}, ...scopeClauses);
};

const applyTaskUpdates = (task, payload = {}) => {
  if (payload.title !== undefined) {
    task.title = normalizeString(payload.title) || task.title;
  }

  if (payload.description !== undefined) {
    task.description = normalizeString(payload.description) || "";
  }

  if (payload.dueDate !== undefined) {
    const nextDueDate = normalizeDate(payload.dueDate);
    if (nextDueDate) {
      task.dueDate = nextDueDate;
    }
  }

  if (payload.urgency !== undefined) {
    task.urgency = normalizeUrgency(payload.urgency, task.urgency);
  }

  if (payload.propertyKey !== undefined) {
    task.propertyKey = normalizeString(payload.propertyKey) || "";
  }

  if (payload.propertyAddress !== undefined) {
    task.propertyAddress = normalizeString(payload.propertyAddress) || "";
  }

  if (payload.sourceType !== undefined) {
    task.sourceType = normalizeSourceType(payload.sourceType, task.sourceType);
  }

  if (payload.sourceId !== undefined) {
    task.sourceId = normalizeString(payload.sourceId) || "";
  }

  if (payload.sourceLabel !== undefined) {
    task.sourceLabel = normalizeString(payload.sourceLabel) || "";
  }

  if (payload.status !== undefined) {
    task.status = normalizeStatus(payload.status, task.status);
  }

  if (task.status === "complete") {
    task.completedAt = task.completedAt || new Date();
  } else {
    task.completedAt = null;
  }

  if (task.sourceType === "general") {
    task.sourceId = "";
    if (!task.sourceLabel) {
      task.sourceLabel = "General";
    }
  }
};

const getAuthorizedTask = async (taskId, userId) => {
  const task = await Task.findOne({ _id: taskId, user: userId });
  return task || null;
};

exports.getTasks = async (req, res) => {
  try {
    const query = {
      user: req.user.id,
      ...buildScopeQuery(req.query),
    };

    const urgency = normalizeString(req.query.urgency);
    const status = normalizeString(req.query.status);

    if (urgency && validUrgencies.has(urgency)) {
      query.urgency = urgency;
    }

    if (status && validStatuses.has(status)) {
      query.status = status;
    }

    const tasks = await Task.find(query).sort({
      status: 1,
      dueDate: 1,
      updatedAt: -1,
    });

    res.json(tasks);
  } catch (error) {
    console.error("Get tasks error:", error);
    res.status(500).json({ msg: "Failed to load tasks." });
  }
};

exports.createTask = async (req, res) => {
  try {
    const title = normalizeString(req.body.title);
    const dueDate = normalizeDate(req.body.dueDate);

    if (!title || !dueDate) {
      return res.status(400).json({ msg: "Task title and due date are required." });
    }

    const task = new Task({
      user: req.user.id,
      title,
      description: normalizeString(req.body.description) || "",
      dueDate,
      urgency: normalizeUrgency(req.body.urgency),
      status: normalizeStatus(req.body.status),
      propertyKey: normalizeString(req.body.propertyKey) || "",
      propertyAddress: normalizeString(req.body.propertyAddress) || "",
      sourceType: normalizeSourceType(req.body.sourceType),
      sourceId: normalizeString(req.body.sourceId) || "",
      sourceLabel: normalizeString(req.body.sourceLabel) || "",
    });

    applyTaskUpdates(task, { status: task.status });

    await task.save();
    res.status(201).json(task);
  } catch (error) {
    console.error("Create task error:", error);
    res.status(500).json({ msg: "Failed to create task." });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const task = await getAuthorizedTask(req.params.id, req.user.id);

    if (!task) {
      return res.status(404).json({ msg: "Task not found." });
    }

    applyTaskUpdates(task, req.body);

    if (!normalizeString(task.title) || !task.dueDate) {
      return res.status(400).json({ msg: "Task title and due date are required." });
    }

    await task.save();
    res.json(task);
  } catch (error) {
    console.error("Update task error:", error);
    res.status(500).json({ msg: "Failed to update task." });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const task = await getAuthorizedTask(req.params.id, req.user.id);

    if (!task) {
      return res.status(404).json({ msg: "Task not found." });
    }

    await task.deleteOne();
    res.json({ msg: "Task removed." });
  } catch (error) {
    console.error("Delete task error:", error);
    res.status(500).json({ msg: "Failed to delete task." });
  }
};
