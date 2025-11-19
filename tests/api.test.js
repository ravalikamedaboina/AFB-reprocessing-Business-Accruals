const request = require("supertest");
const app = require("../server");
const User = require("../models/User");
const Accrual = require("../models/Accrual");

describe("AFB Business Accruals API", () => {
  let authToken;
  let userId;
  let accrualId;

  beforeAll(async () => {
    // Setup test database connection
    // This would typically connect to a test database
  });

  afterAll(async () => {
    // Clean up test database
    // Close database connection
  });

  describe("Authentication", () => {
    test("POST /api/auth/register - should register a new user", async () => {
      const userData = {
        username: "testuser",
        email: "test@afb.com",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        businessUnit: "AFB",
        department: "Finance",
        jobTitle: "Analyst",
      };

      const response = await request(app)
        .post("/api/auth/register")
        .send(userData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("token");
      expect(response.body.user.email).toBe(userData.email);

      authToken = response.body.token;
      userId = response.body.user.id;
    });

    test("POST /api/auth/login - should login user with valid credentials", async () => {
      const response = await request(app).post("/api/auth/login").send({
        email: "test@afb.com",
        password: "password123",
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token");
      expect(response.body.user.email).toBe("test@afb.com");
    });

    test("POST /api/auth/login - should reject invalid credentials", async () => {
      const response = await request(app).post("/api/auth/login").send({
        email: "test@afb.com",
        password: "wrongpassword",
      });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Invalid credentials");
    });

    test("GET /api/auth/profile - should get user profile with valid token", async () => {
      const response = await request(app)
        .get("/api/auth/profile")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.email).toBe("test@afb.com");
    });
  });

  describe("Accruals", () => {
    test("POST /api/accruals - should create a new accrual", async () => {
      const accrualData = {
        businessUnit: "AFB",
        department: "Finance",
        amount: 1000.0,
        currency: "USD",
        accountCode: "4000-001",
        costCenter: "CC-001",
        accrualDate: "2024-01-15",
        periodStart: "2024-01-01",
        periodEnd: "2024-01-31",
        description: "Test accrual for monthly office supplies",
        category: "Operations",
      };

      const response = await request(app)
        .post("/api/accruals")
        .set("Authorization", `Bearer ${authToken}`)
        .send(accrualData);

      expect(response.status).toBe(201);
      expect(response.body.accrual).toHaveProperty("accrualId");
      expect(response.body.accrual.amount).toBe(accrualData.amount);
      expect(response.body.accrual.businessUnit).toBe(accrualData.businessUnit);

      accrualId = response.body.accrual._id;
    });

    test("GET /api/accruals - should fetch accruals list", async () => {
      const response = await request(app)
        .get("/api/accruals")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("accruals");
      expect(response.body).toHaveProperty("pagination");
      expect(Array.isArray(response.body.accruals)).toBe(true);
    });

    test("GET /api/accruals/:id - should fetch specific accrual", async () => {
      const response = await request(app)
        .get(`/api/accruals/${accrualId}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body._id).toBe(accrualId);
      expect(response.body).toHaveProperty("submittedBy");
    });

    test("PUT /api/accruals/:id - should update accrual", async () => {
      const updateData = {
        description: "Updated test accrual description",
        amount: 1500.0,
      };

      const response = await request(app)
        .put(`/api/accruals/${accrualId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.accrual.description).toBe(updateData.description);
      expect(response.body.accrual.amount).toBe(updateData.amount);
    });

    test("PATCH /api/accruals/:id/submit - should submit accrual for approval", async () => {
      const response = await request(app)
        .patch(`/api/accruals/${accrualId}/submit`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.accrual.status).toBe("Pending Approval");
    });

    test("POST /api/accruals/:id/comments - should add comment to accrual", async () => {
      const commentData = {
        comment: "This is a test comment",
      };

      const response = await request(app)
        .post(`/api/accruals/${accrualId}/comments`)
        .set("Authorization", `Bearer ${authToken}`)
        .send(commentData);

      expect(response.status).toBe(200);
      expect(response.body.comment.comment).toBe(commentData.comment);
    });
  });

  describe("Reports", () => {
    test("GET /api/reports/dashboard - should fetch dashboard data", async () => {
      const response = await request(app)
        .get("/api/reports/dashboard")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("summary");
      expect(response.body).toHaveProperty("breakdown");
      expect(response.body.summary).toHaveProperty("totalAccruals");
    });

    test("GET /api/reports/monthly - should fetch monthly report", async () => {
      const response = await request(app)
        .get("/api/reports/monthly?year=2024")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("months");
      expect(response.body).toHaveProperty("year");
      expect(Array.isArray(response.body.months)).toBe(true);
    });

    test("GET /api/reports/export - should export accruals as CSV", async () => {
      const response = await request(app)
        .get("/api/reports/export?format=csv")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    });
  });

  describe("File Upload", () => {
    test("GET /api/upload/template/csv - should download CSV template", async () => {
      const response = await request(app)
        .get("/api/upload/template/csv")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    });

    test("GET /api/upload/template/xlsx - should download Excel template", async () => {
      const response = await request(app)
        .get("/api/upload/template/xlsx")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    });
  });

  describe("Authorization", () => {
    test("GET /api/accruals - should reject requests without token", async () => {
      const response = await request(app).get("/api/accruals");

      expect(response.status).toBe(401);
      expect(response.body.message).toContain("Access denied");
    });

    test("GET /api/accruals - should reject requests with invalid token", async () => {
      const response = await request(app)
        .get("/api/accruals")
        .set("Authorization", "Bearer invalidtoken");

      expect(response.status).toBe(401);
      expect(response.body.message).toContain("Token is not valid");
    });
  });

  describe("Input Validation", () => {
    test("POST /api/accruals - should validate required fields", async () => {
      const invalidData = {
        businessUnit: "AFB",
        // Missing required fields
      };

      const response = await request(app)
        .post("/api/accruals")
        .set("Authorization", `Bearer ${authToken}`)
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("errors");
    });

    test("POST /api/accruals - should validate amount is positive", async () => {
      const invalidData = {
        businessUnit: "AFB",
        department: "Finance",
        amount: -100, // Negative amount
        accountCode: "4000-001",
        costCenter: "CC-001",
        accrualDate: "2024-01-15",
        periodStart: "2024-01-01",
        periodEnd: "2024-01-31",
        description: "Test accrual",
        category: "Operations",
      };

      const response = await request(app)
        .post("/api/accruals")
        .set("Authorization", `Bearer ${authToken}`)
        .send(invalidData);

      expect(response.status).toBe(400);
    });

    test("POST /api/auth/register - should validate email format", async () => {
      const invalidData = {
        username: "testuser2",
        email: "invalid-email", // Invalid email
        password: "password123",
        firstName: "Test",
        lastName: "User",
        businessUnit: "AFB",
        department: "Finance",
        jobTitle: "Analyst",
      };

      const response = await request(app)
        .post("/api/auth/register")
        .send(invalidData);

      expect(response.status).toBe(400);
    });
  });

  describe("Error Handling", () => {
    test("GET /api/accruals/invalid-id - should handle invalid accrual ID", async () => {
      const response = await request(app)
        .get("/api/accruals/invalid-id")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(500);
    });

    test("GET /api/nonexistent-route - should handle 404 routes", async () => {
      const response = await request(app)
        .get("/api/nonexistent-route")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });
});
