{{ config(materialized='table') }}

select cast(day as date) as date_day
from range(date '2018-01-01', date '2019-01-01', interval 1 day) as days(day)
