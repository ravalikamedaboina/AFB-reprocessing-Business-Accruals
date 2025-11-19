const express = require("express");
const router = express.Router();
const Accrual = require("../models/Accrual");
const auth = require("../middleware/auth");
const { body, validationResult } = require("express-validator");
const moment = require("moment");

// Get all accruals with filtering and pagination
router.get("/", auth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      businessUnit,
      department,
      startDate,
      endDate,
      category,
      submittedBy,
    } = req.query;

    // Build filter object
    const filter = {};

    if (status) filter.status = status;
    if (businessUnit) filter.businessUnit = businessUnit;
    if (department) filter.department = department;
    if (category) filter.category = category;
    if (submittedBy) filter.submittedBy = submittedBy;

    // Date range filter
    if (startDate || endDate) {
      filter.accrualDate = {};
      if (startDate) filter.accrualDate.$gte = new Date(startDate);
      if (endDate) filter.accrualDate.$lte = new Date(endDate);
    }

    // For regular users, only show their own accruals unless they have view_all permission
    if (!req.user.hasPermission("view_all_accruals")) {
      filter.submittedBy = req.user._id;
    }

    const skip = (page - 1) * limit;

    const accruals = await Accrual.find(filter)
      .populate("submittedBy", "firstName lastName email")
      .populate("approvedBy", "firstName lastName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Accrual.countDocuments(filter);

    res.json({
      accruals,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (error) {
    console.error("Error fetching accruals:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get single accrual by ID
router.get("/:id", auth, async (req, res) => {
  try {
    const accrual = await Accrual.findById(req.params.id)
      .populate(
        "submittedBy",
        "firstName lastName email businessUnit department"
      )
      .populate("approvedBy", "firstName lastName email")
      .populate("createdBy", "firstName lastName email")
      .populate("updatedBy", "firstName lastName email")
      .populate("comments.user", "firstName lastName email");

    if (!accrual) {
      return res.status(404).json({ message: "Accrual not found" });
    }

    // Check if user can view this accrual
    if (
      !req.user.hasPermission("view_all_accruals") &&
      accrual.submittedBy._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json(accrual);
  } catch (error) {
    console.error("Error fetching accrual:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create new accrual
router.post(
  "/",
  [
    auth,
    body("businessUnit").notEmpty().withMessage("Business unit is required"),
    body("department").notEmpty().withMessage("Department is required"),
    body("amount")
      .isFloat({ min: 0 })
      .withMessage("Amount must be a positive number"),
    body("accountCode").notEmpty().withMessage("Account code is required"),
    body("costCenter").notEmpty().withMessage("Cost center is required"),
    body("accrualDate")
      .isISO8601()
      .withMessage("Valid accrual date is required"),
    body("periodStart")
      .isISO8601()
      .withMessage("Valid period start date is required"),
    body("periodEnd")
      .isISO8601()
      .withMessage("Valid period end date is required"),
    body("description")
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage("Description must be 10-500 characters"),
    body("category").notEmpty().withMessage("Category is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // Generate unique accrual ID
      const currentYear = new Date().getFullYear();
      const count = (await Accrual.countDocuments()) + 1;
      const accrualId = `AFB-${currentYear}-${count
        .toString()
        .padStart(5, "0")}`;

      const accrualData = {
        ...req.body,
        accrualId,
        submittedBy: req.user._id,
        createdBy: req.user._id,
      };

      const accrual = new Accrual(accrualData);
      await accrual.save();

      await accrual.populate("submittedBy", "firstName lastName email");

      res.status(201).json({
        message: "Accrual created successfully",
        accrual,
      });
    } catch (error) {
      console.error("Error creating accrual:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Update accrual
router.put(
  "/:id",
  [
    auth,
    body("amount")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Amount must be a positive number"),
    body("description")
      .optional()
      .trim()
      .isLength({ min: 10, max: 500 })
      .withMessage("Description must be 10-500 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const accrual = await Accrual.findById(req.params.id);
      if (!accrual) {
        return res.status(404).json({ message: "Accrual not found" });
      }

      // Check permissions
      const canEdit =
        req.user.hasPermission("edit_accruals") ||
        (accrual.submittedBy.toString() === req.user._id.toString() &&
          accrual.status === "Draft");

      if (!canEdit) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Don't allow editing of approved/posted accruals
      if (
        ["Approved", "Posted", "Reversed"].includes(accrual.status) &&
        !req.user.hasPermission("edit_accruals")
      ) {
        return res
          .status(400)
          .json({ message: "Cannot edit accrual in current status" });
      }

      const updatedData = {
        ...req.body,
        updatedBy: req.user._id,
      };

      const updatedAccrual = await Accrual.findByIdAndUpdate(
        req.params.id,
        updatedData,
        { new: true }
      ).populate("submittedBy", "firstName lastName email");

      res.json({
        message: "Accrual updated successfully",
        accrual: updatedAccrual,
      });
    } catch (error) {
      console.error("Error updating accrual:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Submit accrual for approval
router.patch("/:id/submit", auth, async (req, res) => {
  try {
    const accrual = await Accrual.findById(req.params.id);
    if (!accrual) {
      return res.status(404).json({ message: "Accrual not found" });
    }

    // Check if user can submit this accrual
    if (
      accrual.submittedBy.toString() !== req.user._id.toString() &&
      !req.user.hasPermission("edit_accruals")
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (accrual.status !== "Draft") {
      return res
        .status(400)
        .json({ message: "Only draft accruals can be submitted" });
    }

    accrual.status = "Pending Approval";
    await accrual.save();

    res.json({
      message: "Accrual submitted for approval",
      accrual,
    });
  } catch (error) {
    console.error("Error submitting accrual:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Approve/Reject accrual
router.patch(
  "/:id/approve",
  [
    auth,
    body("action")
      .isIn(["approve", "reject"])
      .withMessage("Action must be approve or reject"),
    body("comments")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Comments must be less than 500 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      if (!req.user.hasPermission("approve_accruals")) {
        return res.status(403).json({ message: "Access denied" });
      }

      const accrual = await Accrual.findById(req.params.id);
      if (!accrual) {
        return res.status(404).json({ message: "Accrual not found" });
      }

      if (accrual.status !== "Pending Approval") {
        return res
          .status(400)
          .json({
            message: "Only pending accruals can be approved or rejected",
          });
      }

      const { action, comments } = req.body;

      accrual.status = action === "approve" ? "Approved" : "Rejected";
      accrual.approvedBy = req.user._id;
      accrual.approvalDate = new Date();
      accrual.approvalComments = comments;

      await accrual.save();

      res.json({
        message: `Accrual ${action}d successfully`,
        accrual,
      });
    } catch (error) {
      console.error("Error processing accrual approval:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Add comment to accrual
router.post(
  "/:id/comments",
  [
    auth,
    body("comment")
      .trim()
      .isLength({ min: 1, max: 1000 })
      .withMessage("Comment must be 1-1000 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const accrual = await Accrual.findById(req.params.id);
      if (!accrual) {
        return res.status(404).json({ message: "Accrual not found" });
      }

      accrual.comments.push({
        user: req.user._id,
        comment: req.body.comment,
      });

      await accrual.save();
      await accrual.populate("comments.user", "firstName lastName email");

      res.json({
        message: "Comment added successfully",
        comment: accrual.comments[accrual.comments.length - 1],
      });
    } catch (error) {
      console.error("Error adding comment:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Delete accrual
router.delete("/:id", auth, async (req, res) => {
  try {
    const accrual = await Accrual.findById(req.params.id);
    if (!accrual) {
      return res.status(404).json({ message: "Accrual not found" });
    }

    // Check permissions
    const canDelete =
      req.user.hasPermission("delete_accruals") ||
      (accrual.submittedBy.toString() === req.user._id.toString() &&
        accrual.status === "Draft");

    if (!canDelete) {
      return res.status(403).json({ message: "Access denied" });
    }

    await Accrual.findByIdAndDelete(req.params.id);

    res.json({ message: "Accrual deleted successfully" });
  } catch (error) {
    console.error("Error deleting accrual:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
