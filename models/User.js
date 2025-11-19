const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // Basic Information
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      validate: {
        validator: function (email) {
          return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email);
        },
        message: "Please enter a valid email",
      },
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    // Personal Information
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    // Business Information
    businessUnit: {
      type: String,
      required: true,
      enum: ["AFB", "Cargo", "Maintenance", "Ground Services", "Corporate"],
    },
    department: {
      type: String,
      required: true,
    },
    jobTitle: {
      type: String,
      required: true,
    },
    employeeId: {
      type: String,
      unique: true,
      sparse: true,
    },

    // Role and Permissions
    role: {
      type: String,
      required: true,
      enum: ["User", "Approver", "Admin", "Super Admin"],
      default: "User",
    },
    permissions: [
      {
        type: String,
        enum: [
          "create_accruals",
          "approve_accruals",
          "view_all_accruals",
          "edit_accruals",
          "delete_accruals",
          "generate_reports",
          "manage_users",
          "system_admin",
        ],
      },
    ],

    // Account Status
    isActive: {
      type: Boolean,
      default: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
    },

    // Settings
    preferences: {
      emailNotifications: {
        type: Boolean,
        default: true,
      },
      theme: {
        type: String,
        enum: ["light", "dark"],
        default: "light",
      },
      language: {
        type: String,
        default: "en",
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ businessUnit: 1, department: 1 });
userSchema.index({ role: 1, isActive: 1 });

// Virtual for full name
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Check if user has permission
userSchema.methods.hasPermission = function (permission) {
  return this.permissions.includes(permission) || this.role === "Super Admin";
};

module.exports = mongoose.model("User", userSchema);
