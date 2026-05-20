APP_KEY = "hrm"
DISPLAY_NAME = "Base HRM"
API_PREFIX = "/extapi/v1"

SUCCESS_CODES = {1, "1"}

ENDPOINTS = {
    # Employee
    "employee_list": "/employee/list",
    "employee_get": "/employee/get",
    "employee_create": "/employee/create",
    "employee_edit": "/employee/edit",
    "employee_checkincode_set": "/employee/checkincode/set",
    "employee_mass_remove": "/employee/mass.remove",
    # Organization
    "area_list": "/area/list",
    "office_list": "/office/list",
    "position_list": "/position/list",
    "position_types": "/position/types",
    "team_list": "/team/list",
    # Employment info
    "career_records": "/career/records",
    "contract_list": "/contract/list",
    "contract_types": "/contract/types",
    "employee_types": "/employee/types",
    "employee_works": "/employee/works",
    # Education & relations
    "employee_educations": "/employee/educations",
    "employee_relations": "/employee/relations",
    # Merit
    "merit_types": "/merit/types",
    "merit_templates": "/merit/templates",
    "merit_awards": "/merit/awards",
    "merit_certs": "/merit/certs",
    "merit_records": "/merit/records",
    "merit_rules": "/merit/rules",
    # Payroll & attendance
    "payroll_cycles": "/payroll/cycles",
    "payroll_records": "/payroll/records",
    "timesheet_list": "/timesheet/list",
    "timesheet_get": "/timesheet/get",
    # Tax, insurance & legal
    "insurance_list": "/insurance/list",
    "employee_legals": "/employee/legals",
    "tax_list": "/tax/list",
    # Check-in client
    "checkin_client_list": "/checkin.client/list",
    "checkin_client_create": "/checkin.client/create",
    "checkin_client_edit": "/checkin.client/edit",
    "checkin_client_remove": "/checkin.client/remove",
}
