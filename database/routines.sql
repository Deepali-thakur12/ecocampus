CREATE OR REPLACE FUNCTION calculate_purchase_discount (
    p_purchase_amount IN NUMBER,
    p_reusable_container IN CHAR DEFAULT 'N'
) RETURN NUMBER
IS
    v_discount_percent NUMBER(5, 2) := 0;
BEGIN
    IF p_purchase_amount IS NULL OR p_purchase_amount < 0 THEN
        RAISE_APPLICATION_ERROR(-20001, 'Purchase amount cannot be null or negative.');
    END IF;

    IF p_reusable_container IS NULL
       OR p_reusable_container NOT IN ('Y', 'N') THEN
        RAISE_APPLICATION_ERROR(-20002, 'Reusable-container flag must be Y or N.');
    END IF;

    IF p_purchase_amount >= 1000 THEN
        v_discount_percent := 10;
    ELSIF p_purchase_amount >= 500 THEN
        v_discount_percent := 5;
    END IF;

    IF p_reusable_container = 'Y' THEN
        v_discount_percent := v_discount_percent + 2;
    END IF;

    RETURN LEAST(v_discount_percent, 12);
END;
/

CREATE OR REPLACE PROCEDURE create_wallet_account (
    p_student_id IN students.student_id%TYPE,
    p_initial_balance IN wallet_accounts.balance%TYPE,
    p_wallet_id OUT wallet_accounts.wallet_id%TYPE
)
IS
    c_minimum_opening_balance CONSTANT NUMBER := 100;
BEGIN
    IF p_initial_balance IS NULL
       OR p_initial_balance < c_minimum_opening_balance THEN
        RAISE_APPLICATION_ERROR(
            -20003,
            'Opening wallet balance must be at least INR 100.'
        );
    END IF;

    IF p_initial_balance <> ROUND(p_initial_balance, 2) THEN
        RAISE_APPLICATION_ERROR(
            -20015,
            'Opening wallet balance cannot have more than two decimal places.'
        );
    END IF;

    IF p_student_id IS NULL THEN
        RAISE_APPLICATION_ERROR(-20016, 'Student ID is required.');
    END IF;

    INSERT INTO wallet_accounts (student_id, balance)
    VALUES (p_student_id, p_initial_balance)
    RETURNING wallet_id INTO p_wallet_id;
EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        RAISE_APPLICATION_ERROR(-20004, 'This student already has a wallet.');
END;
/

CREATE OR REPLACE PROCEDURE process_purchase (
    p_student_id IN students.student_id%TYPE,
    p_product_id IN products.product_id%TYPE,
    p_quantity IN NUMBER,
    p_reusable_container IN CHAR DEFAULT 'N',
    p_order_id OUT orders.order_id%TYPE
)
IS
    v_wallet_id wallet_accounts.wallet_id%TYPE;
    v_balance wallet_accounts.balance%TYPE;
    v_product_name products.product_name%TYPE;
    v_unit_price products.unit_price%TYPE;
    v_stock_quantity products.stock_quantity%TYPE;
    v_is_refillable products.is_refillable%TYPE;
    v_subtotal orders.subtotal%TYPE;
    v_discount_percent orders.discount_percent%TYPE;
    v_discount_amount orders.discount_amount%TYPE;
    v_total_amount orders.total_amount%TYPE;
BEGIN
    SAVEPOINT purchase_start;

    IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> TRUNC(p_quantity) THEN
        RAISE_APPLICATION_ERROR(-20005, 'Quantity must be a positive whole number.');
    END IF;

    IF p_student_id IS NULL OR p_product_id IS NULL THEN
        RAISE_APPLICATION_ERROR(-20017, 'Student ID and product ID are required.');
    END IF;

    IF p_reusable_container IS NULL
       OR p_reusable_container NOT IN ('Y', 'N') THEN
        RAISE_APPLICATION_ERROR(-20006, 'Reusable-container flag must be Y or N.');
    END IF;

    SELECT product_name, unit_price, stock_quantity, is_refillable
    INTO v_product_name, v_unit_price, v_stock_quantity, v_is_refillable
    FROM products
    WHERE product_id = p_product_id
      AND is_active = 'Y'
    FOR UPDATE;

    IF v_stock_quantity < p_quantity THEN
        RAISE_APPLICATION_ERROR(-20007, 'Insufficient product stock.');
    END IF;

    SELECT wallet_id, balance
    INTO v_wallet_id, v_balance
    FROM wallet_accounts
    WHERE student_id = p_student_id
    FOR UPDATE;

    v_subtotal := ROUND(v_unit_price * p_quantity, 2);
    v_discount_percent := calculate_purchase_discount(
        v_subtotal,
        CASE
            WHEN v_is_refillable = 'Y' THEN p_reusable_container
            ELSE 'N'
        END
    );
    v_discount_amount := ROUND(v_subtotal * v_discount_percent / 100, 2);
    v_total_amount := v_subtotal - v_discount_amount;

    IF v_balance < v_total_amount THEN
        RAISE_APPLICATION_ERROR(-20008, 'Insufficient wallet balance.');
    END IF;

    INSERT INTO orders (
        student_id,
        product_id,
        product_name,
        unit_price,
        quantity,
        subtotal,
        discount_percent,
        discount_amount,
        total_amount,
        reusable_container_used
    )
    VALUES (
        p_student_id,
        p_product_id,
        v_product_name,
        v_unit_price,
        p_quantity,
        v_subtotal,
        v_discount_percent,
        v_discount_amount,
        v_total_amount,
        p_reusable_container
    )
    RETURNING order_id INTO p_order_id;

    UPDATE wallet_accounts
    SET balance = balance - v_total_amount
    WHERE wallet_id = v_wallet_id;

    UPDATE products
    SET stock_quantity = stock_quantity - p_quantity
    WHERE product_id = p_product_id;

    IF v_is_refillable = 'Y' THEN
        INSERT INTO sustainability_log (
            order_id,
            student_id,
            activity_type,
            reusable_container_used,
            containers_avoided
        )
        VALUES (
            p_order_id,
            p_student_id,
            'REFILL_PURCHASE',
            p_reusable_container,
            CASE WHEN p_reusable_container = 'Y' THEN p_quantity ELSE 0 END
        );
    END IF;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        ROLLBACK TO purchase_start;
        RAISE_APPLICATION_ERROR(-20019, 'Product or student wallet was not found.');
    WHEN OTHERS THEN
        ROLLBACK TO purchase_start;
        RAISE;
END;
/

CREATE OR REPLACE PROCEDURE transfer_funds (
    p_sender_wallet_id IN wallet_accounts.wallet_id%TYPE,
    p_receiver_wallet_id IN wallet_accounts.wallet_id%TYPE,
    p_amount IN fund_transfers.amount%TYPE,
    p_transfer_id OUT fund_transfers.transfer_id%TYPE
)
IS
    v_first_wallet_id wallet_accounts.wallet_id%TYPE;
    v_second_wallet_id wallet_accounts.wallet_id%TYPE;
    v_first_balance wallet_accounts.balance%TYPE;
    v_second_balance wallet_accounts.balance%TYPE;
    v_sender_balance wallet_accounts.balance%TYPE;
BEGIN
    SAVEPOINT transfer_start;

    IF p_sender_wallet_id IS NULL OR p_receiver_wallet_id IS NULL THEN
        RAISE_APPLICATION_ERROR(-20009, 'Sender and receiver wallet IDs are required.');
    END IF;

    IF p_sender_wallet_id = p_receiver_wallet_id THEN
        RAISE_APPLICATION_ERROR(-20010, 'Sender and receiver wallets must be different.');
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE_APPLICATION_ERROR(-20011, 'Transfer amount must be greater than zero.');
    END IF;

    IF p_amount <> ROUND(p_amount, 2) THEN
        RAISE_APPLICATION_ERROR(
            -20018,
            'Transfer amount cannot have more than two decimal places.'
        );
    END IF;

    v_first_wallet_id := LEAST(p_sender_wallet_id, p_receiver_wallet_id);
    v_second_wallet_id := GREATEST(p_sender_wallet_id, p_receiver_wallet_id);

    SELECT balance
    INTO v_first_balance
    FROM wallet_accounts
    WHERE wallet_id = v_first_wallet_id
    FOR UPDATE;

    SELECT balance
    INTO v_second_balance
    FROM wallet_accounts
    WHERE wallet_id = v_second_wallet_id
    FOR UPDATE;

    IF p_sender_wallet_id = v_first_wallet_id THEN
        v_sender_balance := v_first_balance;
    ELSE
        v_sender_balance := v_second_balance;
    END IF;

    IF v_sender_balance < p_amount THEN
        RAISE_APPLICATION_ERROR(-20012, 'Insufficient sender wallet balance.');
    END IF;

    UPDATE wallet_accounts
    SET balance = balance - p_amount
    WHERE wallet_id = p_sender_wallet_id;

    UPDATE wallet_accounts
    SET balance = balance + p_amount
    WHERE wallet_id = p_receiver_wallet_id;

    INSERT INTO fund_transfers (
        sender_wallet_id,
        receiver_wallet_id,
        amount
    )
    VALUES (
        p_sender_wallet_id,
        p_receiver_wallet_id,
        p_amount
    )
    RETURNING transfer_id INTO p_transfer_id;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        ROLLBACK TO transfer_start;
        RAISE_APPLICATION_ERROR(-20013, 'Sender or receiver wallet does not exist.');
    WHEN OTHERS THEN
        ROLLBACK TO transfer_start;
        RAISE;
END;
/

CREATE OR REPLACE PROCEDURE report_low_stock (
    p_threshold IN NUMBER DEFAULT 10
)
IS
    CURSOR c_low_stock (p_stock_threshold NUMBER) IS
        SELECT product_id, product_name, stock_quantity
        FROM products
        WHERE is_active = 'Y'
          AND stock_quantity < p_stock_threshold
        ORDER BY stock_quantity, product_name;
BEGIN
    IF p_threshold IS NULL OR p_threshold < 0 THEN
        RAISE_APPLICATION_ERROR(-20014, 'Stock threshold cannot be null or negative.');
    END IF;

    DBMS_OUTPUT.PUT_LINE('Low-stock products (below ' || p_threshold || '):');
    DBMS_OUTPUT.PUT_LINE('ID | Product | Stock');

    FOR product_row IN c_low_stock(p_threshold) LOOP
        DBMS_OUTPUT.PUT_LINE(
            product_row.product_id || ' | ' ||
            product_row.product_name || ' | ' ||
            product_row.stock_quantity
        );
    END LOOP;
END;
/
