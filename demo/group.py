import requests
import os
import json
import re
import pandas as pd

def sanitize_folder_name(name):
    """
    Replace special characters that are invalid in Windows folder names with underscore
    Invalid characters: / \\ : * ? " < > |
    """
    # Replace invalid characters with underscore
    invalid_chars = r'[/\\:*?"<>|]'
    sanitized = re.sub(invalid_chars, '_', name)
    # Remove leading/trailing spaces and dots
    sanitized = sanitized.strip('. ')
    return sanitized

def create_empty_excel(folder_path):
    """
    Create empty Excel file with column headers only
    """
    # Define column headers
    columns = [
        'ID',
        'Tên request',
        'Thời gian tạo',
        'Thời gian cập nhật',
        'Người theo dõi',
        'Người sở hữu',
        'Người duyệt',
        'Người từ chối',
        'ID nhóm request',
        'Số lượng bài đăng',
        'Số lượng files',
        'Số lượng TTC dạng bảng',
        'Folder request',
        'Files'
    ]
    
    # Create empty DataFrame with columns
    df = pd.DataFrame(columns=columns)
    
    # Create Excel file
    excel_path = os.path.join(folder_path, 'thong_tin_requests.xlsx')
    df.to_excel(excel_path, index=False, engine='openpyxl')
    
    return excel_path

def get_group_list():
    """
    Fetch group list from Base API and create folders for each group
    Loops through pages starting from page 1 until less than 20 items are returned
    """
    # Get access token from user
    access_token = input("Enter access_token_v2: ").strip()
    
    # API endpoint
    url = "https://request.base.com.vn/extapi/v1/group/list"
    
    # Headers
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    
    page = 1
    total_groups_created = 0
    
    try:
        while True:
            print(f"\n{'='*50}")
            print(f"Fetching page {page}...")
            print(f"{'='*50}")
            
            # Data payload
            data = {
                'access_token_v2': access_token,
                'page': str(page)
            }
            
            # Make POST request
            response = requests.post(url, headers=headers, data=data)
            
            # Print response status
            print(f"Status Code: {response.status_code}")
            
            # Parse JSON response
            if response.status_code == 200:
                json_response = response.json()
                
                # Print formatted response
                print("\nFormatted JSON Response:")
                print(json.dumps(json_response, indent=2, ensure_ascii=False))
                
                # Extract groups array
                if 'groups' in json_response:
                    groups = json_response['groups']
                    groups_count = len(groups)
                    print(f"\nFound {groups_count} groups on page {page}.")
                    
                    if groups_count > 0:
                        print("Creating folders and Excel files...\n")
                        
                        # Create Requests folder if not exists
                        requests_base_folder = "Requests"
                        if not os.path.exists(requests_base_folder):
                            os.makedirs(requests_base_folder)
                            print(f"✓ Created base folder: {requests_base_folder}\n")
                        
                        # Create folders for each group inside Requests folder
                        for group in groups:
                            group_id = group.get('id', '')
                            group_name = group.get('name', '')
                            
                            # Sanitize group name to remove invalid characters
                            sanitized_name = sanitize_folder_name(group_name)
                            
                            # Format folder name as [id] name
                            folder_name = f"[{group_id}] {sanitized_name}"
                            
                            # Create full path inside Requests folder
                            full_folder_path = os.path.join(requests_base_folder, folder_name)
                            
                            # Create group folder if it doesn't exist
                            if not os.path.exists(full_folder_path):
                                os.makedirs(full_folder_path)
                                print(f"✓ Created folder: Requests/{folder_name}")
                                total_groups_created += 1
                            else:
                                print(f"- Folder already exists: Requests/{folder_name}")
                            
                            # Check if Excel file already exists
                            excel_path = os.path.join(full_folder_path, 'thong_tin_requests.xlsx')
                            if os.path.exists(excel_path):
                                print(f"  - Excel file already exists, skipping...")
                            else:
                                # Create empty Excel file with headers
                                try:
                                    excel_path = create_empty_excel(full_folder_path)
                                    print(f"  ✓ Created Excel: {os.path.basename(excel_path)}")
                                except Exception as e:
                                    print(f"  ✗ Error creating Excel: {e}")
                            
                            print()  # Empty line for readability
                    
                    # Check if we should continue to next page
                    if groups_count < 20:
                        print(f"\n{'='*50}")
                        print(f"Page {page} returned {groups_count} groups (< 20).")
                        print("Stopping pagination.")
                        print(f"{'='*50}")
                        break
                    else:
                        print(f"\nPage {page} has 20 or more groups. Continuing to next page...")
                        page += 1
                else:
                    print("\nNo 'groups' key found in response.")
                    break
            else:
                print(f"\nError: {response.text}")
                break
        
        # Create [direct] Đề xuất trực tiếp folder after all groups are processed
        print(f"\n{'='*50}")
        print("Creating special folder for direct requests...")
        print(f"{'='*50}")
        
        requests_base_folder = "Requests"
        direct_folder_name = "[direct] Đề xuất trực tiếp"
        direct_folder_path = os.path.join(requests_base_folder, direct_folder_name)
        
        if not os.path.exists(direct_folder_path):
            os.makedirs(direct_folder_path)
            print(f"✓ Created folder: Requests/{direct_folder_name}")
            
            # Create empty Excel file for direct requests
            try:
                excel_path = create_empty_excel(direct_folder_path)
                print(f"  ✓ Created Excel: {os.path.basename(excel_path)}")
            except Exception as e:
                print(f"  ✗ Error creating Excel: {e}")
        else:
            print(f"- Folder already exists: Requests/{direct_folder_name}")
            
            # Check if Excel file exists
            excel_path = os.path.join(direct_folder_path, 'thong_tin_requests.xlsx')
            if os.path.exists(excel_path):
                print(f"  - Excel file already exists")
            else:
                try:
                    excel_path = create_empty_excel(direct_folder_path)
                    print(f"  ✓ Created Excel: {os.path.basename(excel_path)}")
                except Exception as e:
                    print(f"  ✗ Error creating Excel: {e}")
        
        print(f"\n{'='*50}")
        print(f"Summary: Processed {page} page(s)")
        print(f"Created {total_groups_created} new folders")
        print(f"{'='*50}")
            
    except requests.exceptions.RequestException as e:
        print(f"Error making request: {e}")
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON response: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")

if __name__ == "__main__":
    get_group_list()
