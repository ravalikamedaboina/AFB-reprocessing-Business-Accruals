const mongoose = require("mongoose");

const accrualSchema = new mongoose.Schema(
  {
    // Basic Information
    accrualId: {
      type: String,
      required: true,
      unique: true,
    },
    businessUnit: {
      type: String,
      required: true,
      enum: ["AFB", "Cargo", "Maintenance", "Ground Services", "Corporate"],
    },
    department: {
      type: String,
      required: true,
    },

    // Financial Information
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
      enum: ["USD", "CAD", "EUR"],
    },
    accountCode: {
      type: String,
      required: true,
    },
    costCenter: {
      type: String,
      required: true,
    },

    // Date Information
    accrualDate: {
      type: Date,
      required: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    reversalDate: {
      type: Date,
    },

    // Description and Classification
    description: {
      type: String,
      required: true,
      maxlength: 500,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Personnel",
        "Operations",
        "Maintenance",
        "Fuel",
        "Insurance",
        "Other",
      ],
    },
    subcategory: {
      type: String,
    },

    // Status and Workflow
    status: {
      type: String,
      default: "Draft",
      enum: [
        "Draft",
        "Pending Approval",
        "Approved",
        "Posted",
        "Reversed",
        "Rejected",
      ],
    },
    priority: {
      type: String,
      default: "Medium",
      enum: ["Low", "Medium", "High", "Critical"],
    },

    // Approval Workflow
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvalDate: {
      type: Date,
    },
    approvalComments: {
      type: String,
    },

    // Supporting Documentation
    attachments: [
      {
        filename: String,
        originalName: String,
        path: String,
        size: Number,
        uploadDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Journal Entry Information
    journalEntryNumber: {
      type: String,
    },
    postingDate: {
      type: Date,
    },

    // Additional Metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Comments and Notes
    comments: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        comment: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
accrualSchema.index({ businessUnit: 1, accrualDate: -1 });
accrualSchema.index({ status: 1, createdAt: -1 });
accrualSchema.index({ submittedBy: 1, status: 1 });
accrualSchema.index({ accrualId: 1 });

// Virtual for formatted amount
accrualSchema.virtual("formattedAmount").get(function () {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: this.currency,
  }).format(this.amount);
});

// Virtual for days pending
accrualSchema.virtual("daysPending").get(function () {
  if (this.status === "Pending Approval") {
    return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
  }
  return 0;
});

module.exports = mongoose.model("Accrual", accrualSchema);
