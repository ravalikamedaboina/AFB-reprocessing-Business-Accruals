# AFB Business Accruals Management System

A comprehensive Node.js application for managing business accruals for Alaska Freight and Brokerage (AFB) operations.

## Features

### Core Functionality

- **Accrual Management**: Create, edit, view, and track business accruals
- **Approval Workflow**: Multi-level approval process for accrual requests
- **User Authentication**: Secure login with role-based access control
- **Dashboard**: Real-time statistics and overview of accrual activities
- **Reporting**: Comprehensive reports and analytics
- **Bulk Import**: Excel/CSV file upload for batch accrual processing
- **File Attachments**: Support for documents and supporting files

### Business Features

- **Multi-Business Unit Support**: AFB, Cargo, Maintenance, Ground Services, Corporate
- **Department Tracking**: Granular department-level organization
- **Cost Center Integration**: Link accruals to specific cost centers
- **Currency Support**: USD, CAD, EUR currency handling
- **Category Classification**: Personnel, Operations, Maintenance, Fuel, Insurance, Other
- **Period Management**: Track accrual periods and reversal dates

### Technical Features

- **Modern Web Interface**: Bootstrap 5 responsive design
- **RESTful API**: Complete API for external integrations
- **Database**: MongoDB with Mongoose ODM
- **Security**: JWT authentication, input validation, file upload protection
- **File Handling**: Secure file upload and attachment management
- **Export Capabilities**: CSV and Excel export functionality

## Installation

### Prerequisites

- Node.js (v18.0.0 or higher)
- MongoDB (v5.0 or higher)
- npm (v9.0.0 or higher)

### Setup Steps

1. **Clone or Download the Project**

   ```bash
   cd AFB-reprocessing-Business-Accruals
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Environment Configuration**

   ```bash
   cp .env.example .env
   ```

   Update the `.env` file with your configuration:

   ```
   NODE_ENV=development
   PORT=3000
   MONGODB_URI=mongodb://localhost:27017/afb_accruals
   JWT_SECRET=your-super-secret-jwt-key-here
   JWT_EXPIRE=7d
   MAX_FILE_SIZE=10485760
   UPLOAD_PATH=./uploads
   ```

4. **Start MongoDB**
   Make sure MongoDB is running on your system.

5. **Run the Application**

   For development:

   ```bash
   npm run dev
   ```

   For production:

   ```bash
   npm start
   ```

6. **Access the Application**
   Open your browser and navigate to `http://localhost:3000`

## Usage

### First Time Setup

1. **Register a User**: Use the registration endpoint or create a user directly in the database
2. **Login**: Access the application with your credentials
3. **Create Accruals**: Start adding business accruals through the web interface
4. **Setup Approval Workflow**: Configure users with appropriate roles and permissions

### User Roles and Permissions

- **User**: Create and manage own accruals
- **Approver**: Approve/reject accruals + User permissions
- **Admin**: Full access to all accruals and reports + Approver permissions
- **Super Admin**: System administration + Admin permissions

### API Endpoints

#### Authentication

- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/auth/profile` - Get user profile
- `PUT /api/auth/profile` - Update user profile
- `PUT /api/auth/change-password` - Change password

#### Accruals

- `GET /api/accruals` - List accruals with filtering
- `POST /api/accruals` - Create new accrual
- `GET /api/accruals/:id` - Get accrual details
- `PUT /api/accruals/:id` - Update accrual
- `DELETE /api/accruals/:id` - Delete accrual
- `PATCH /api/accruals/:id/submit` - Submit for approval
- `PATCH /api/accruals/:id/approve` - Approve/reject accrual
- `POST /api/accruals/:id/comments` - Add comment

#### Reports

- `GET /api/reports/dashboard` - Dashboard statistics
- `GET /api/reports/monthly` - Monthly reports
- `GET /api/reports/business-units` - Business unit comparison
- `GET /api/reports/aging` - Aging report for pending approvals
- `GET /api/reports/export` - Export accruals to CSV/Excel

#### File Upload

- `POST /api/upload/bulk-import` - Bulk import from CSV/Excel
- `POST /api/upload/attachment/:accrualId` - Upload attachment
- `GET /api/upload/attachment/:accrualId/:attachmentId` - Download attachment
- `DELETE /api/upload/attachment/:accrualId/:attachmentId` - Delete attachment
- `GET /api/upload/template/:format` - Download import template

## File Structure

```
AFB-reprocessing-Business-Accruals/
├── models/
│   ├── Accrual.js          # Accrual data model
│   └── User.js             # User data model
├── routes/
│   ├── accruals.js         # Accrual management routes
│   ├── auth.js             # Authentication routes
│   ├── reports.js          # Reporting routes
│   └── upload.js           # File upload routes
├── middleware/
│   └── auth.js             # Authentication middleware
├── public/
│   ├── index.html          # Main web interface
│   ├── css/
│   │   └── style.css       # Custom styles
│   └── js/
│       └── app.js          # Frontend JavaScript
├── uploads/                # File upload directory
├── server.js               # Main application server
├── package.json            # Dependencies and scripts
├── .env.example            # Environment configuration template
└── README.md               # This file
```

## Development

### Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues

### Database Schema

#### Accrual Model

- Basic information (ID, business unit, department)
- Financial data (amount, currency, account code, cost center)
- Date tracking (accrual date, period start/end, reversal date)
- Description and categorization
- Status and workflow tracking
- Approval information
- Attachments and comments
- Audit trail

#### User Model

- Personal information
- Business unit and department assignment
- Role and permissions
- Account status and preferences
- Authentication data

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## Security

- JWT-based authentication
- Password hashing with bcrypt
- Input validation and sanitization
- File upload restrictions
- CORS protection
- Helmet.js security headers
- Rate limiting capabilities

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Commit your changes (`git commit -am 'Add some feature'`)
4. Push to the branch (`git push origin feature/new-feature`)
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:

- Create an issue in the repository
- Contact the development team
- Check the documentation and API reference

## Changelog

### Version 1.0.0

- Initial release
- Core accrual management functionality
- User authentication and authorization
- Web interface and API
- Reporting and export capabilities
- Bulk import functionality
