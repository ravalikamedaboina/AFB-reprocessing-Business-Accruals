const express = require("express");
const router = express.Router();
const Accrual = require("../models/Accrual");
const auth = require("../middleware/auth");
const moment = require("moment");

// Dashboard summary statistics
router.get("/dashboard", auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const isAdmin = req.user.hasPermission("view_all_accruals");

    // Base filter for user access
    const baseFilter = isAdmin ? {} : { submittedBy: userId };

    // Current month filter
    const currentMonth = {
      ...baseFilter,
      accrualDate: {
        $gte: moment().startOf("month").toDate(),
        $lte: moment().endOf("month").toDate(),
      },
    };

    // Parallel queries for dashboard stats
    const [
      totalAccruals,
      pendingApproval,
      approvedThisMonth,
      rejectedThisMonth,
      draftAccruals,
      totalAmount,
      monthlyAmount,
      statusBreakdown,
      categoryBreakdown,
    ] = await Promise.all([
      Accrual.countDocuments(baseFilter),
      Accrual.countDocuments({ ...baseFilter, status: "Pending Approval" }),
      Accrual.countDocuments({ ...currentMonth, status: "Approved" }),
      Accrual.countDocuments({ ...currentMonth, status: "Rejected" }),
      Accrual.countDocuments({ ...baseFilter, status: "Draft" }),

      // Total amount aggregation
      Accrual.aggregate([
        { $match: baseFilter },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),

      // Monthly amount aggregation
      Accrual.aggregate([
        { $match: currentMonth },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),

      // Status breakdown
      Accrual.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            total: { $sum: "$amount" },
          },
        },
      ]),

      // Category breakdown
      Accrual.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
            total: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    res.json({
      summary: {
        totalAccruals,
        pendingApproval,
        approvedThisMonth,
        rejectedThisMonth,
        draftAccruals,
        totalAmount: totalAmount[0]?.total || 0,
        monthlyAmount: monthlyAmount[0]?.total || 0,
      },
      breakdown: {
        byStatus: statusBreakdown,
        byCategory: categoryBreakdown,
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Monthly accruals report
router.get("/monthly", auth, async (req, res) => {
  try {
    const { year = moment().year(), businessUnit, department } = req.query;
    const isAdmin = req.user.hasPermission("view_all_accruals");

    // Base filter
    let baseFilter = {
      accrualDate: {
        $gte: new Date(year, 0, 1),
        $lte: new Date(year, 11, 31),
      },
    };

    if (!isAdmin) {
      baseFilter.submittedBy = req.user._id;
    }

    if (businessUnit) baseFilter.businessUnit = businessUnit;
    if (department) baseFilter.department = department;

    const monthlyData = await Accrual.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: {
            month: { $month: "$accrualDate" },
            status: "$status",
          },
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]);

    // Format data for frontend
    const months = Array.from({ length: 12 }, (_, i) => {
      const monthData = monthlyData.filter((item) => item._id.month === i + 1);
      return {
        month: moment().month(i).format("MMMM"),
        data: monthData.reduce((acc, item) => {
          acc[item._id.status] = {
            count: item.count,
            amount: item.totalAmount,
          };
          return acc;
        }, {}),
      };
    });

    res.json({ months, year: parseInt(year) });
  } catch (error) {
    console.error("Monthly report error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Business unit comparison report
router.get("/business-units", auth, async (req, res) => {
  try {
    if (!req.user.hasPermission("view_all_accruals")) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { startDate, endDate } = req.query;

    const filter = {};
    if (startDate || endDate) {
      filter.accrualDate = {};
      if (startDate) filter.accrualDate.$gte = new Date(startDate);
      if (endDate) filter.accrualDate.$lte = new Date(endDate);
    }

    const businessUnitData = await Accrual.aggregate([
      { $match: filter },
      {
        $group: {
          _id: {
            businessUnit: "$businessUnit",
            status: "$status",
          },
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          avgAmount: { $avg: "$amount" },
        },
      },
      { $sort: { "_id.businessUnit": 1 } },
    ]);

    // Group by business unit
    const result = businessUnitData.reduce((acc, item) => {
      const bu = item._id.businessUnit;
      if (!acc[bu]) {
        acc[bu] = {};
      }
      acc[bu][item._id.status] = {
        count: item.count,
        totalAmount: item.totalAmount,
        avgAmount: item.avgAmount,
      };
      return acc;
    }, {});

    res.json(result);
  } catch (error) {
    console.error("Business unit report error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Aging report for pending approvals
router.get("/aging", auth, async (req, res) => {
  try {
    if (!req.user.hasPermission("approve_accruals")) {
      return res.status(403).json({ message: "Access denied" });
    }

    const pendingAccruals = await Accrual.find({
      status: "Pending Approval",
    })
      .populate(
        "submittedBy",
        "firstName lastName email businessUnit department"
      )
      .sort({ createdAt: 1 });

    const now = new Date();
    const agingBuckets = {
      "0-7 days": [],
      "8-14 days": [],
      "15-30 days": [],
      "31+ days": [],
    };

    pendingAccruals.forEach((accrual) => {
      const daysPending = Math.floor(
        (now - accrual.createdAt) / (1000 * 60 * 60 * 24)
      );

      if (daysPending <= 7) {
        agingBuckets["0-7 days"].push(accrual);
      } else if (daysPending <= 14) {
        agingBuckets["8-14 days"].push(accrual);
      } else if (daysPending <= 30) {
        agingBuckets["15-30 days"].push(accrual);
      } else {
        agingBuckets["31+ days"].push(accrual);
      }
    });

    res.json(agingBuckets);
  } catch (error) {
    console.error("Aging report error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Export accruals to CSV
router.get("/export", auth, async (req, res) => {
  try {
    const {
      status,
      businessUnit,
      department,
      startDate,
      endDate,
      format = "csv",
    } = req.query;

    const isAdmin = req.user.hasPermission("view_all_accruals");

    // Build filter
    const filter = {};
    if (!isAdmin) filter.submittedBy = req.user._id;
    if (status) filter.status = status;
    if (businessUnit) filter.businessUnit = businessUnit;
    if (department) filter.department = department;

    if (startDate || endDate) {
      filter.accrualDate = {};
      if (startDate) filter.accrualDate.$gte = new Date(startDate);
      if (endDate) filter.accrualDate.$lte = new Date(endDate);
    }

    const accruals = await Accrual.find(filter)
      .populate("submittedBy", "firstName lastName email")
      .populate("approvedBy", "firstName lastName email")
      .sort({ createdAt: -1 });

    if (format === "csv") {
      // CSV Headers
      const csvHeaders = [
        "Accrual ID",
        "Business Unit",
        "Department",
        "Amount",
        "Currency",
        "Account Code",
        "Cost Center",
        "Accrual Date",
        "Period Start",
        "Period End",
        "Description",
        "Category",
        "Status",
        "Submitted By",
        "Approval Date",
        "Created Date",
      ].join(",");

      // CSV Data
      const csvData = accruals.map((accrual) =>
        [
          accrual.accrualId,
          accrual.businessUnit,
          accrual.department,
          accrual.amount,
          accrual.currency,
          accrual.accountCode,
          accrual.costCenter,
          moment(accrual.accrualDate).format("YYYY-MM-DD"),
          moment(accrual.periodStart).format("YYYY-MM-DD"),
          moment(accrual.periodEnd).format("YYYY-MM-DD"),
          `"${accrual.description}"`,
          accrual.category,
          accrual.status,
          accrual.submittedBy ? accrual.submittedBy.fullName : "",
          accrual.approvalDate
            ? moment(accrual.approvalDate).format("YYYY-MM-DD")
            : "",
          moment(accrual.createdAt).format("YYYY-MM-DD"),
        ].join(",")
      );

      const csvContent = [csvHeaders, ...csvData].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=accruals_export_${moment().format(
          "YYYYMMDD"
        )}.csv`
      );
      res.send(csvContent);
    } else {
      // JSON format
      res.json(accruals);
    }
  } catch (error) {
    console.error("Export error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
