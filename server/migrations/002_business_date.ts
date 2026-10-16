export default `
-- Store-local calendar date (see setting utc_offset_minutes) so "daily" reports match the shop's day.
ALTER TABLE sales ADD COLUMN business_date TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_sales_business_date ON sales(business_date);
`;
