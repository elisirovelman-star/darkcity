DarkCityShop = {
    -- Public HTTPS URL of the Node.js website. Do not use localhost unless API runs on this same machine.
    apiBase = "https://YOUR-DOMAIN.example",
    -- Must exactly match MTA_API_TOKEN in the website backend .env file.
    apiToken = "CHANGE_THIS_TO_THE_SAME_LONG_RANDOM_TOKEN",
    pollInterval = 10000,
    -- Keys must match rank IDs in website config.js; values must match ACL group names in acl.xml.
    rankGroups = {
        vip = "VIP",
        premium = "Premium",
        gold = "Gold",
        diamond = "Diamond"
    },
    -- Account data is written for other server resources to read.
    accountDataKey = "darkcity:rank"
}
