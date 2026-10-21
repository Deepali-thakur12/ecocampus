MERGE INTO students target
USING (
    SELECT 'Aarav Sharma' full_name, 'aarav.sharma@ecocampus.edu' email,
           'Environmental Science' department FROM dual
    UNION ALL
    SELECT 'Mira Patel', 'mira.patel@ecocampus.edu', 'Computer Science' FROM dual
    UNION ALL
    SELECT 'Ishaan Rao', 'ishaan.rao@ecocampus.edu', 'Business' FROM dual
) source
ON (target.email = source.email)
WHEN NOT MATCHED THEN
    INSERT (full_name, email, department)
    VALUES (source.full_name, source.email, source.department);

MERGE INTO wallet_accounts target
USING (
    SELECT student_id, 1500 balance
    FROM students
    WHERE email = 'aarav.sharma@ecocampus.edu'
    UNION ALL
    SELECT student_id, 800
    FROM students
    WHERE email = 'mira.patel@ecocampus.edu'
    UNION ALL
    SELECT student_id, 1200
    FROM students
    WHERE email = 'ishaan.rao@ecocampus.edu'
) source
ON (target.student_id = source.student_id)
WHEN NOT MATCHED THEN
    INSERT (student_id, balance)
    VALUES (source.student_id, source.balance);

MERGE INTO products target
USING (
    SELECT 'Filtered Water Refill' product_name, 'REFILL' category,
           20 unit_price, 120 stock_quantity, 'Y' is_refillable FROM dual
    UNION ALL
    SELECT 'Reusable Steel Bottle', 'DRINKWARE', 250, 35, 'N' FROM dual
    UNION ALL
    SELECT 'Bamboo Toothbrush', 'PERSONAL_CARE', 80, 45, 'N' FROM dual
    UNION ALL
    SELECT 'Recycled Notebook', 'STATIONERY', 60, 8, 'N' FROM dual
    UNION ALL
    SELECT 'Laundry Liquid Refill', 'REFILL', 90, 6, 'Y' FROM dual
) source
ON (target.product_name = source.product_name)
WHEN NOT MATCHED THEN
    INSERT (
        product_name,
        category,
        unit_price,
        stock_quantity,
        is_refillable
    )
    VALUES (
        source.product_name,
        source.category,
        source.unit_price,
        source.stock_quantity,
        source.is_refillable
    );

COMMIT;
