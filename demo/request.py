import requests
import json
import os
import re
import pandas as pd
from datetime import datetime
from openpyxl import load_workbook
import urllib.parse
import base64

def sanitize_folder_name(name):
    """
    Replace special characters with underscore
    """
    invalid_chars = r'[/\\:*?"<>|]'
    sanitized = re.sub(invalid_chars, '_', name)
    sanitized = sanitized.strip('. ')
    return sanitized

def truncate_name(name, max_length=50):
    """
    Truncate name to maximum length
    If longer, keep first max_length characters and add '...'
    """
    if len(name) <= max_length:
        return name
    return name[:max_length] + '...'

def convert_timestamp_to_datetime(timestamp):
    """
    Convert Unix timestamp to datetime string format dd/MM/yyyy hh:mm:ss
    """
    try:
        if timestamp:
            dt = datetime.fromtimestamp(int(timestamp))
            return dt.strftime('%d/%m/%Y %H:%M:%S')
    except:
        pass
    return ''

def extract_usernames(users_list):
    """
    Extract usernames from list of user objects and join with comma
    """
    if not users_list or not isinstance(users_list, list):
        return ''
    usernames = [user.get('username', '') for user in users_list if isinstance(user, dict)]
    return ', '.join(filter(None, usernames))

def count_form_table_items(form_data):
    """
    Count items in form with type = 'input-table' or 'select-master'
    """
    if not form_data or not isinstance(form_data, list):
        return 0
    count = 0
    for item in form_data:
        if isinstance(item, dict):
            item_type = item.get('type', '')
            if item_type in ['input-table', 'select-master']:
                count += 1
    return count

def find_group_folder(group_id):
    """
    Find group folder by ID in Requests folder
    If folder name is too long, rename it to 50 chars
    """
    requests_folder = "Requests"
    if not os.path.exists(requests_folder):
        return None
    
    # Search for folder starting with [group_id]
    for folder_name in os.listdir(requests_folder):
        folder_path = os.path.join(requests_folder, folder_name)
        if os.path.isdir(folder_path):
            # Check if folder name starts with [group_id]
            if folder_name.startswith(f"[{group_id}]"):
                # Extract the name part after [group_id]
                prefix = f"[{group_id}] "
                if folder_name.startswith(prefix):
                    name_part = folder_name[len(prefix):]
                    
                    # Check if name is too long (> 50 chars)
                    if len(name_part) > 50:
                        print(f"  Group folder name too long ({len(name_part)} chars), truncating to 50...")
                        truncated_name = truncate_name(name_part, 50)
                        new_folder_name = f"[{group_id}] {truncated_name}"
                        new_folder_path = os.path.join(requests_folder, new_folder_name)
                        
                        # Rename folder
                        try:
                            os.rename(folder_path, new_folder_path)
                            print(f"  ✓ Renamed group folder to: {new_folder_name}")
                            return new_folder_path
                        except Exception as e:
                            print(f"  ✗ Error renaming group folder: {e}")
                            return folder_path
                
                return folder_path
    return None

def append_to_excel(excel_path, request_data):
    """
    Append request data to Excel file if ID doesn't exist yet
    Returns True if added, False if ID already exists
    """
    request_id = request_data.get('id', '')
    
    # Read existing Excel
    df_existing = pd.read_excel(excel_path, engine='openpyxl')
    
    # Check if ID already exists
    if 'ID' in df_existing.columns:
        if request_id in df_existing['ID'].values:
            return False  # ID already exists, skip
    
    # Prepare row data matching the column order
    row_data = {
        'ID': request_id,
        'Tên request': request_data.get('name', ''),
        'Thời gian tạo': convert_timestamp_to_datetime(request_data.get('since')),
        'Thời gian cập nhật': convert_timestamp_to_datetime(request_data.get('last_update')),
        'Người theo dõi': extract_usernames(request_data.get('followers', [])),
        'Người sở hữu': extract_usernames(request_data.get('owners', [])),
        'Người duyệt': extract_usernames(request_data.get('approvals', [])),
        'Người từ chối': extract_usernames(request_data.get('rejecters', [])),
        'ID nhóm request': request_data.get('group_id', ''),
        'Số lượng bài đăng': request_data.get('stats', {}).get('posts', 0) if isinstance(request_data.get('stats'), dict) else 0,
        'Số lượng files': len(request_data.get('files', [])) if isinstance(request_data.get('files'), list) else 0,
        'Số lượng TTC dạng bảng': count_form_table_items(request_data.get('form', [])),
        'Folder request': '',
        'Files': ''
    }
    
    # Append new row
    df_new = pd.DataFrame([row_data])
    df_combined = pd.concat([df_existing, df_new], ignore_index=True)
    
    # Save back to Excel
    df_combined.to_excel(excel_path, index=False, engine='openpyxl')
    
    return True  # Successfully added

def download_file(url, save_path):
    """
    Download file from URL
    """
    try:
        response = requests.get(url, stream=True)
        if response.status_code == 200:
            with open(save_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return True
    except:
        pass
    return False

def decode_input_table_placeholder(placeholder):
    """
    Decode placeholder to get column headers
    Returns: (headers_list, format_type)
    
    Format types:
    - 'simple-br': RAW placeholder contains "--br--"
    - 'select-master': JSON with type='select-master' (TH 2.1)
    - 'simple-json': JSON with other types like 'text', 'int', 'select' (TH 2.2)
    - None: Could not decode
    """
    print(f"      [DEBUG] Raw placeholder: {placeholder}")
    print(f"      [DEBUG] Placeholder type: {type(placeholder)}")
    print(f"      [DEBUG] Last 20 chars: '{placeholder[-20:]}'")
    print(f"      [DEBUG] Length: {len(placeholder)}, mod 4: {len(placeholder) % 4}")
    
    # TH1: Check if RAW placeholder contains "--br--" (before base64 decode)
    if '--br--' in placeholder:
        print(f"      [DEBUG] Format: --br-- found in RAW placeholder (no base64 decode needed)")
        # Split by --br-- and trim
        headers = [item.strip() for item in placeholder.split('--br--')]
        # Filter out empty strings
        headers = [h for h in headers if h]
        print(f"      [DEBUG] Headers from --br-- split: {headers}")
        return (headers, 'simple-br')
    
    # TH2: No "--br--" in raw placeholder → decode base64 and parse JSON
    print(f"      [DEBUG] No --br-- in raw placeholder, trying base64 decode + JSON parse...")
    
    try:
        # Remove all whitespace characters from base64 string
        if isinstance(placeholder, str):
            # Remove spaces, tabs, newlines, carriage returns
            placeholder_clean = ''.join(placeholder.split())
            print(f"      [DEBUG] After removing whitespace, length: {len(placeholder_clean)}")
            
            # Add padding using smart formula: ((4 - len % 4) % 4)
            placeholder_clean += "=" * ((4 - len(placeholder_clean) % 4) % 4)
            print(f"      [DEBUG] After padding, length: {len(placeholder_clean)}")
            
            placeholder_bytes = placeholder_clean.encode('ascii')
        else:
            placeholder_bytes = placeholder
            
        # Decode base64 (urlsafe handles both standard and URL-safe base64)
        decoded_bytes = base64.urlsafe_b64decode(placeholder_bytes)
        decoded_str = decoded_bytes.decode('utf-8')
        print(f"      [DEBUG] Decoded placeholder: {decoded_str}")
        
        # Parse as JSON
        data = json.loads(decoded_str)
        print(f"      [DEBUG] JSON parsed successfully, type: {type(data)}")
        
        # Check if it's an array
        if isinstance(data, list) and len(data) > 0:
            print(f"      [DEBUG] JSON is array with {len(data)} items")
            first_item = data[0]
            print(f"      [DEBUG] First item type: {type(first_item)}")
            
            if isinstance(first_item, dict):
                item_type = first_item.get('type')
                print(f"      [DEBUG] First item 'type' field: {item_type}")
                
                # TH 2.1: Check if first item has type='select-master'
                if item_type == 'select-master':
                    print(f"      [DEBUG] Format: TH 2.1 - select-master JSON array")
                    # Extract 'name' values as headers
                    headers = []
                    for item in data:
                        if isinstance(item, dict):
                            name = item.get('name', '')
                            if name:
                                headers.append(name)
                    print(f"      [DEBUG] Extracted headers from 'name' fields: {headers}")
                    return (headers, 'select-master')
                # TH 2.2: Has 'type' key but not 'select-master' (e.g., 'text', 'int', 'select')
                elif 'type' in first_item:
                    print(f"      [DEBUG] Format: TH 2.2 - type='{item_type}' (simple format)")
                    # Extract 'name' values as headers (same as 2.1 but simpler value decode)
                    headers = []
                    for item in data:
                        if isinstance(item, dict):
                            name = item.get('name', '')
                            if name:
                                headers.append(name)
                    print(f"      [DEBUG] Extracted headers from 'name' fields: {headers}")
                    return (headers, 'simple-json')
                else:
                    print(f"      [DEBUG] First item has no 'type' field")
        else:
            print(f"      [DEBUG] JSON is not array or empty")
            
    except UnicodeEncodeError as e:
        print(f"      [DEBUG] Non-ASCII characters in placeholder string: {e}")
    except json.JSONDecodeError as e:
        print(f"      [DEBUG] Not valid JSON format: {e}")
    except Exception as e:
        print(f"      [DEBUG] Error decoding placeholder: {e}")
        import traceback
        print(f"      [DEBUG] Traceback: {traceback.format_exc()}")
    
    return ([], None)

def decode_select_master_value(value):
    """
    Decode value for select-master format
    1. Decode base64 value
    2. Parse JSON → array of items
    3. For each item (row):
       - Loop through each position (column)
       - Position 0: decode base64 → get vals[0].value
       - Other positions: decode base64 → get value
    4. Return 2D array
    """
    print(f"      [DEBUG] Decoding select-master value...")
    
    try:
        # Remove all whitespace characters from base64 string
        if isinstance(value, str):
            value_clean = ''.join(value.split())
            
            # Add padding using smart formula
            value_clean += "=" * ((4 - len(value_clean) % 4) % 4)
            
            value_bytes = value_clean.encode('ascii')
        else:
            value_bytes = value
            
        # Decode base64 (urlsafe handles both standard and URL-safe base64)
        decoded_bytes = base64.urlsafe_b64decode(value_bytes)
        decoded_str = decoded_bytes.decode('utf-8')
        print(f"      [DEBUG] Decoded value: {decoded_str}")
        
        # Parse as JSON
        items = json.loads(decoded_str)
        print(f"      [DEBUG] Parsed JSON, type: {type(items)}, length: {len(items) if isinstance(items, list) else 'N/A'}")
        
        if not isinstance(items, list):
            print(f"      [DEBUG] Value is not array")
            return []
        
        rows_data = []
        
        # Loop through each item (row)
        for row_idx, item in enumerate(items):
            print(f"      [DEBUG] Processing row {row_idx + 1}/{len(items)}")
            
            if not isinstance(item, list):
                print(f"      [DEBUG] Item is not array, type: {type(item)}")
                continue
            
            row_values = []
            
            # Loop through each position (column) in item
            for col_idx, cell_encoded in enumerate(item):
                print(f"      [DEBUG]   Processing column {col_idx}, raw: {str(cell_encoded)}")
                
                try:
                    # Remove whitespace and decode base64 for this cell
                    if isinstance(cell_encoded, str):
                        cell_clean = ''.join(cell_encoded.split())
                        
                        # Add padding using smart formula
                        cell_clean += "=" * ((4 - len(cell_clean) % 4) % 4)
                        
                        cell_bytes = cell_clean.encode('ascii')
                    else:
                        # Might already be decoded or different format
                        row_values.append(str(cell_encoded))
                        continue
                    
                    # Decode base64 (urlsafe handles both standard and URL-safe base64)
                    cell_decoded_bytes = base64.urlsafe_b64decode(cell_bytes)
                    cell_decoded_str = cell_decoded_bytes.decode('utf-8')
                    print(f"      [DEBUG]   Decoded cell: {cell_decoded_str}")
                    
                    # Parse as JSON
                    cell_data = json.loads(cell_decoded_str)
                    
                    # Position 0: get vals[0].value
                    if col_idx == 0:
                        if isinstance(cell_data, dict) and 'vals' in cell_data:
                            vals = cell_data.get('vals', [])
                            if isinstance(vals, list) and len(vals) > 0:
                                cell_value = vals[0].get('value', '')
                                print(f"      [DEBUG]   Position 0, extracted vals[0].value: {cell_value}")
                                row_values.append(cell_value)
                            else:
                                print(f"      [DEBUG]   Position 0, no vals found")
                                row_values.append('')
                        else:
                            print(f"      [DEBUG]   Position 0, no vals key, using raw: {cell_data}")
                            row_values.append(str(cell_data))
                    else:
                        # Other positions: get value
                        if isinstance(cell_data, dict) and 'value' in cell_data:
                            cell_value = cell_data.get('value', '')
                            print(f"      [DEBUG]   Position {col_idx}, extracted value: {cell_value}")
                            row_values.append(cell_value)
                        else:
                            # Might be direct value
                            print(f"      [DEBUG]   Position {col_idx}, using raw: {cell_data}")
                            row_values.append(str(cell_data))
                            
                except Exception as e:
                    print(f"      [DEBUG]   Error decoding cell at position {col_idx}: {e}")
                    row_values.append('')
            
            if row_values:
                rows_data.append(row_values)
                print(f"      [DEBUG] Row {row_idx + 1} values: {row_values}")
        
        print(f"      [DEBUG] Total rows extracted: {len(rows_data)}")
        return rows_data
        
    except Exception as e:
        print(f"      [DEBUG] Error in decode_select_master_value: {e}")
        import traceback
        print(f"      [DEBUG] Traceback: {traceback.format_exc()}")
    
    return []

def decode_input_table_value(value):
    """
    Decode value to get table data
    Note: This function will be called for both formats
    The select-master format should use decode_select_master_value instead
    """
    print(f"      [DEBUG] Raw value (first 300 chars): {value[:300]}")
    print(f"      [DEBUG] Value type: {type(value)}")
    
    try:
        # Remove all whitespace characters from base64 string
        if isinstance(value, str):
            value_clean = ''.join(value.split())
            
            # Add padding using smart formula
            value_clean += "=" * ((4 - len(value_clean) % 4) % 4)
            
            value_bytes = value_clean.encode('ascii')
        else:
            value_bytes = value
            
        # Decode base64 (urlsafe handles both standard and URL-safe base64)
        decoded_bytes = base64.urlsafe_b64decode(value_bytes)
        decoded_str = decoded_bytes.decode('utf-8')
        print(f"      [DEBUG] Decoded value (first 300 chars): {decoded_str[:300]}")
        
        # Try to parse as JSON
        data = json.loads(decoded_str)
        print(f"      [DEBUG] JSON parsed successfully, type: {type(data)}")
        
        if isinstance(data, list):
            print(f"      [DEBUG] Parsed as JSON array with {len(data)} items")
            if len(data) > 0:
                print(f"      [DEBUG] First row type: {type(data[0])}")
                if isinstance(data[0], list):
                    print(f"      [DEBUG] First row has {len(data[0])} columns")
            return data
        else:
            print(f"      [DEBUG] Decoded value is not a list, type: {type(data)}")
            return []
            
    except UnicodeEncodeError as e:
        print(f"      [DEBUG] Non-ASCII characters in value string: {e}")
    except json.JSONDecodeError as e:
        print(f"      [DEBUG] Value is not valid JSON after decode: {e}")
    except Exception as e:
        print(f"      [DEBUG] Error decoding value: {e}")
        import traceback
        print(f"      [DEBUG] Traceback: {traceback.format_exc()}")
    
    return []

def process_input_table(form_item, request_folder):
    """
    Process input-table form item and create Excel
    """
    table_name = form_item.get('name', 'table')
    table_type = form_item.get('type', 'unknown')
    
    # Sanitize and truncate table name (max 50 chars)
    sanitized_name = sanitize_folder_name(table_name)
    truncated_name = truncate_name(sanitized_name, 50)
    excel_filename = f"{truncated_name}.xlsx"
    excel_path = os.path.join(request_folder, excel_filename)
    
    print(f"      ================================")
    print(f"      Processing table: '{truncated_name}' (type: {table_type})")
    print(f"      ================================")
    
    # Get headers from placeholder
    placeholder = form_item.get('placeholder', '')
    print(f"      Placeholder length: {len(placeholder)} chars")
    
    # Decode placeholder to get headers and format type
    headers, format_type = decode_input_table_placeholder(placeholder)
    print(f"      => Format Type: {format_type}")
    print(f"      => Final Headers: {headers}")
    print(f"      => Header count: {len(headers)}")
    
    if not headers:
        print(f"      ✗ Could not decode headers from placeholder")
        print(f"      ================================")
        return
    
    # Get data from value - use appropriate decoder based on format
    value = form_item.get('value', '')
    print(f"      Value length: {len(value)} chars")
    
    if format_type == 'simple-br':
        # TH1: Simple format with --br--
        rows_data = decode_input_table_value(value)
    elif format_type == 'select-master':
        # TH 2.1: Select-master format (complex multi-layer decode)
        rows_data = decode_select_master_value(value)
    elif format_type == 'simple-json':
        # TH 2.2: JSON format with simple types (text, int, select)
        rows_data = decode_input_table_value(value)
    else:
        print(f"      ✗ Unknown format type: {format_type}")
        rows_data = []
    
    print(f"      => Final Rows: {len(rows_data)} rows")
    if rows_data and len(rows_data) > 0:
        print(f"      => First row sample: {rows_data[0][:3] if len(rows_data[0]) > 3 else rows_data[0]}")
    
    # Delete old Excel file if exists (per requirement)
    if os.path.exists(excel_path):
        try:
            os.remove(excel_path)
            print(f"      - Deleted existing file: {excel_filename}")
        except Exception as e:
            print(f"      ✗ Error deleting old file: {e}")
    
    # Create DataFrame
    try:
        df = pd.DataFrame(rows_data, columns=headers)
        
        # Save to Excel
        df.to_excel(excel_path, index=False, engine='openpyxl')
        print(f"      ✓ Created table Excel: {excel_filename}")
    except Exception as e:
        print(f"      ✗ Error creating DataFrame/Excel: {e}")
    
    print(f"      ================================")

def format_post_comment_info(item, is_post=True):
    """
    Format post or comment information to text
    Format: 
    - Post (both title & content): since --- [title] username: content
    - Post (only content or title): since --- username: text
    - Comment: since --- [comment] username: text
    Strips HTML tags from content/title
    """
    since = item.get('since', '')
    since_formatted = convert_timestamp_to_datetime(since)
    
    username = item.get('username', 'Unknown')
    
    # Get title and content
    content = item.get('content', '').strip()
    title = item.get('title', '').strip()
    
    # Strip HTML tags
    if content:
        content = re.sub(r'<[^>]+>', '', content).strip()
    if title:
        title = re.sub(r'<[^>]+>', '', title).strip()
    
    # Format based on type and available data
    if is_post:
        # Post: check if both title and content exist
        if title and content:
            formatted = f"{since_formatted} --- [{title}] {username}: {content}"
        elif content:
            formatted = f"{since_formatted} --- {username}: {content}"
        elif title:
            formatted = f"{since_formatted} --- {username}: {title}"
        else:
            formatted = f"{since_formatted} --- {username}: (No content)"
    else:
        # Comment: use content or title
        text = content if content else (title if title else '(No content)')
        formatted = f"{since_formatted} --- [comment] {username}: {text}"
    
    return formatted

def fetch_comments(hid, access_token):
    """
    Fetch all comments for a specific post (hid)
    Returns list of formatted comment strings
    """
    url = "https://request.base.com.vn/extapi/v1/request/comment/load"
    
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': 'basessid=udua80icot7en7r3t7gsn9ftrv1oo9g53n36f5nb4c0n19dmjnp449vi9bnnn6ttsjufceen3cr31ebu'
    }
    
    data = {
        'access_token_v2': access_token,
        'hid': hid,
        'method': 'prev',
        'position': '0'
    }
    
    try:
        response = requests.post(url, headers=headers, data=data)
        if response.status_code == 200:
            json_response = response.json()
            comments = json_response.get('comments', [])
            
            formatted_comments = []
            for comment in comments:
                formatted = format_post_comment_info(comment, is_post=False)
                formatted_comments.append(formatted)
            
            return formatted_comments
        else:
            print(f"        ✗ Error fetching comments: {response.status_code}")
            return []
    except Exception as e:
        print(f"        ✗ Error fetching comments: {e}")
        return []

def process_posts_and_comments(request_id, request_folder, access_token):
    """
    Fetch all posts and comments for a request and save to post_and_comment.txt
    """
    print(f"    Processing posts and comments...")
    
    url = "https://request.base.com.vn/extapi/v1/request/post/load"
    
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': 'basessid=udua80icot7en7r3t7gsn9ftrv1oo9g53n36f5nb4c0n19dmjnp449vi9bnnn6ttsjufceen3cr31ebu'
    }
    
    all_formatted_text = []
    last_id = ''
    page_count = 0
    total_posts = 0
    
    try:
        while True:
            page_count += 1
            print(f"      Fetching posts page {page_count} (last_id: {last_id if last_id else 'initial'})...")
            
            data = {
                'access_token_v2': access_token,
                'id': request_id,
                'last_id': last_id
            }
            
            response = requests.post(url, headers=headers, data=data)
            
            if response.status_code == 200:
                json_response = response.json()
                posts = json_response.get('posts', [])
                posts_count = len(posts)
                
                print(f"        Found {posts_count} post(s)")
                
                if posts_count == 0:
                    break
                
                # Process each post
                for post in posts:
                    total_posts += 1
                    post_id = post.get('id', '')
                    hid = post.get('hid', '')
                    
                    # Format post info
                    post_text = format_post_comment_info(post, is_post=True)
                    all_formatted_text.append(post_text)
                    
                    # Fetch comments for this post
                    if hid:
                        print(f"        Fetching comments for post {post_id}...")
                        comments = fetch_comments(hid, access_token)
                        print(f"          Found {len(comments)} comment(s)")
                        
                        # Add comments to text
                        for comment in comments:
                            all_formatted_text.append(comment)
                    
                    # Update last_id for next iteration
                    last_id = post_id
                
                # Check if we should continue
                if posts_count < 10:
                    print(f"        Received {posts_count} posts (< 10), stopping pagination")
                    break
            else:
                print(f"        ✗ Error fetching posts: {response.status_code}")
                break
        
        # Save to file
        if all_formatted_text:
            txt_filename = "post_and_comment.txt"
            txt_path = os.path.join(request_folder, txt_filename)
            
            # Delete old file if exists
            if os.path.exists(txt_path):
                os.remove(txt_path)
            
            with open(txt_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(all_formatted_text))
            
            print(f"    ✓ Created posts & comments file: {txt_filename}")
            print(f"      Total: {total_posts} post(s), {len(all_formatted_text) - total_posts} comment(s)")
        else:
            print(f"    - No posts or comments found")
            
    except Exception as e:
        print(f"    ✗ Error processing posts and comments: {e}")
        import traceback
        print(f"    Traceback: {traceback.format_exc()}")

def process_request(request_data, group_folder, access_token):
    """
    Process a single request: update Excel, create folder, download files, process forms, posts & comments
    """
    request_id = request_data.get('id', '')
    request_name = request_data.get('name', 'unnamed')
    
    print(f"\n  Processing request [{request_id}] {request_name}")
    
    # 1. Update Excel file
    excel_path = os.path.join(group_folder, 'thong_tin_requests.xlsx')
    try:
        is_added = append_to_excel(excel_path, request_data)
        if is_added:
            print(f"    ✓ Updated Excel with request data")
        else:
            print(f"    - Request ID already exists in Excel, skipping...")
    except Exception as e:
        print(f"    ✗ Error updating Excel: {e}")
        return
    
    # 2. Create request folder with truncated name (max 50 chars)
    sanitized_name = sanitize_folder_name(request_name)
    truncated_name = truncate_name(sanitized_name, 50)
    request_folder_name = f"[{request_id}] {truncated_name}"
    request_folder = os.path.join(group_folder, request_folder_name)
    
    # If folder exists with old long name, rename it
    old_folder_name = f"[{request_id}] {sanitized_name}"
    old_folder_path = os.path.join(group_folder, old_folder_name)
    
    if os.path.exists(old_folder_path) and old_folder_name != request_folder_name:
        try:
            os.rename(old_folder_path, request_folder)
            print(f"    ✓ Renamed request folder to: {request_folder_name}")
        except Exception as e:
            print(f"    ✗ Error renaming request folder: {e}")
            request_folder = old_folder_path
    elif not os.path.exists(request_folder):
        os.makedirs(request_folder)
        print(f"    ✓ Created request folder: {request_folder_name}")
    else:
        print(f"    - Request folder already exists")
    
    # 3. Download files if any
    files = request_data.get('files', [])
    if files and len(files) > 0:
        # Create "Tệp đính kèm" folder
        attachments_folder = os.path.join(request_folder, "Tệp đính kèm")
        if not os.path.exists(attachments_folder):
            os.makedirs(attachments_folder)
            print(f"    ✓ Created attachments folder: Tệp đính kèm")
        
        print(f"    Downloading {len(files)} file(s)...")
        for file_item in files:
            if isinstance(file_item, dict):
                ext_download = file_item.get('ext_download', '')
                filename = file_item.get('name', 'unknown_file')
                
                if ext_download:
                    file_path = os.path.join(attachments_folder, filename)
                    if download_file(ext_download, file_path):
                        print(f"      ✓ Downloaded: {filename}")
                    else:
                        print(f"      ✗ Failed to download: {filename}")
    
    # 4. Process form items (input-table and select-master)
    form = request_data.get('form', [])
    if form and len(form) > 0:
        table_items = [item for item in form if isinstance(item, dict) and item.get('type') in ['input-table', 'select-master']]
        
        if table_items:
            print(f"    Processing {len(table_items)} table form(s)...")
            for form_item in table_items:
                form_type = form_item.get('type')
                form_name = form_item.get('name', 'unknown')
                sanitized_form_name = sanitize_folder_name(form_name)
                
                print(f"      Form type: '{form_type}', Name: '{sanitized_form_name}'")
                
                # Both input-table and select-master use the same processing logic
                if form_type in ['input-table', 'select-master']:
                    try:
                        process_input_table(form_item, request_folder)
                    except Exception as e:
                        import traceback
                        print(f"      ✗ Error processing '{form_type}' form '{sanitized_form_name}': {e}")
                        print(f"      Traceback: {traceback.format_exc()}")
        
        # 5. Process other form items (custom fields with types other than input-table/select-master)
        other_items = [item for item in form if isinstance(item, dict) and item.get('type') not in ['input-table', 'select-master']]
        
        if other_items:
            print(f"    Processing {len(other_items)} custom field(s)...")
            
            # Collect headers (names) and values from all custom fields
            custom_fields_data = {}
            for item in other_items:
                field_name = item.get('name', '')
                field_value = item.get('value', '')
                field_type = item.get('type', '')
                
                if field_name:
                    custom_fields_data[field_name] = field_value
                    print(f"      Field: '{field_name}' (type: {field_type}), Value: {str(field_value)[:50]}")
            
            # Create Excel file for custom fields
            if custom_fields_data:
                try:
                    custom_excel_filename = "Thông tin trường tùy chỉnh.xlsx"
                    custom_excel_path = os.path.join(request_folder, custom_excel_filename)
                    
                    # Delete old file if exists
                    if os.path.exists(custom_excel_path):
                        os.remove(custom_excel_path)
                        print(f"    - Deleted existing file: {custom_excel_filename}")
                    
                    # Create DataFrame with single row
                    df = pd.DataFrame([custom_fields_data])
                    
                    # Save to Excel
                    df.to_excel(custom_excel_path, index=False, engine='openpyxl')
                    print(f"    ✓ Created custom fields Excel: {custom_excel_filename}")
                except Exception as e:
                    print(f"    ✗ Error creating custom fields Excel: {e}")
                    import traceback
                    print(f"    Traceback: {traceback.format_exc()}")
    
    # 6. Process posts and comments
    process_posts_and_comments(request_id, request_folder, access_token)

def get_request_list():
    """
    Fetch request list from Base API for a specific group and process each request
    """
    # Get access token from user
    access_token = input("Enter access_token_v2: ").strip()
    
    # Get group ID from user
    group_id = input("Enter group_id: ").strip()
    
    # Find group folder
    group_folder = find_group_folder(group_id)
    if not group_folder:
        print(f"Error: Group folder for ID [{group_id}] not found in Requests folder!")
        return
    
    print(f"\nFound group folder: {group_folder}")
    
    # API endpoint
    url = "https://request.base.com.vn/extapi/v1/request/list"
    
    # Headers
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': 'basessid=udua80icot7en7r3t7gsn9ftrv1oo9g53n36f5nb4c0n19dmjnp449vi9bnnn6ttsjufceen3cr31ebu'
    }
    
    page = 0
    total_processed = 0
    
    try:
        while True:
            print(f"\n{'='*60}")
            print(f"Fetching page {page} (limit=1)...")
            print(f"{'='*60}")
            
            # Data payload with limit=1 to process one request at a time
            data = {
                'access_token_v2': access_token,
                'group': group_id,
                'page': str(page),
                'limit': '1'
            }
            
            # Make POST request
            response = requests.post(url, headers=headers, data=data)
            
            if response.status_code == 200:
                json_response = response.json()
                requests_list = json_response.get('requests', [])
                
                # Stop if no requests found
                if not requests_list or len(requests_list) == 0:
                    print(f"\nNo requests found on page {page}. Stopping.")
                    break
                
                print(f"Found {len(requests_list)} request(s) on page {page}")
                
                # Process the single request
                for request_data in requests_list:
                    process_request(request_data, group_folder, access_token)
                    total_processed += 1
                
                # Move to next page
                page += 1
            else:
                print(f"\nError Response: {response.text}")
                break
        
        print(f"\n{'='*60}")
        print(f"Summary: Processed {total_processed} request(s) across {page} page(s)")
        print(f"{'='*60}")
                
    except requests.exceptions.RequestException as e:
        print(f"Error making request: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")

if __name__ == "__main__":
    get_request_list()
