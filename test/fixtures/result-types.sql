SELECT
  NULL::VARCHAR AS null_value,
  9007199254740993::BIGINT AS bigint_value,
  12345678901234567890.1234::DECIMAL(24, 4) AS decimal_value,
  DATE '2026-09-14' AS date_value,
  TIMESTAMP '2026-09-14 12:34:56.123456' AS timestamp_value,
  [1::BIGINT, NULL, 3::BIGINT] AS list_value,
  {'label': 'duck', 'count': 42::BIGINT} AS struct_value,
  MAP {'first': 1::BIGINT, 'second': 2::BIGINT} AS map_value;
