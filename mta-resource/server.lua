local function log(message)
    outputDebugString("[DarkCityShop] " .. tostring(message), 3)
end

local function requestHeaders()
    return {
        ["x-darkcity-token"] = DarkCityShop.apiToken,
        ["Content-Type"] = "application/json"
    }
end

local function acknowledge(orderId)
    local body = toJSON({ orderId = orderId }, true)
    fetchRemote(DarkCityShop.apiBase .. "/api/mta/ack", {
        method = "POST",
        headers = requestHeaders(),
        postData = body,
        connectionAttempts = 3,
        connectTimeout = 10000
    }, function(responseData, errno)
        if errno ~= 0 then
            log("ACK failed for " .. tostring(orderId) .. ", errno=" .. tostring(errno))
            return
        end
        log("Rank delivery acknowledged for order " .. tostring(orderId))
    end)
end

local function applyGrant(grant)
    if type(grant) ~= "table" or not grant.orderId or not grant.accountName or not grant.rankId then
        return false, "Malformed grant"
    end

    local expectedGroup = DarkCityShop.rankGroups[grant.rankId]
    if not expectedGroup or expectedGroup ~= grant.aclGroup then
        return false, "Rank/group mismatch for " .. tostring(grant.orderId)
    end

    -- This bridge uses MTA's built-in account + ACL system.
    -- If the live server uses a custom MySQL account/group system, adapt this block to that schema.
    local account = getAccount(grant.accountName)
    if not account then
        return false, "MTA account does not exist: " .. tostring(grant.accountName)
    end

    local targetGroup = aclGetGroup(expectedGroup)
    if not targetGroup then
        return false, "ACL group does not exist: " .. tostring(expectedGroup)
    end

    -- Remove the account from other shop rank groups to prevent stacked tiers.
    for _, groupName in pairs(DarkCityShop.rankGroups) do
        local group = aclGetGroup(groupName)
        if group and isObjectInACLGroup("user." .. grant.accountName, group) then
            aclGroupRemoveObject(group, "user." .. grant.accountName)
        end
    end

    local objectName = "user." .. grant.accountName
    if not isObjectInACLGroup(objectName, targetGroup) then
        if not aclGroupAddObject(targetGroup, objectName) then
            return false, "Could not add account to ACL group " .. expectedGroup
        end
    end

    setAccountData(account, DarkCityShop.accountDataKey, grant.rankName)
    log("Granted " .. grant.rankName .. " to " .. grant.accountName .. " (" .. grant.orderId .. ")")
    return true
end

local function pollApprovedOrders()
    fetchRemote(DarkCityShop.apiBase .. "/api/mta/pending", {
        method = "GET",
        headers = requestHeaders(),
        connectionAttempts = 3,
        connectTimeout = 10000
    }, function(responseData, errno)
        if errno ~= 0 then
            log("Poll failed, errno=" .. tostring(errno))
            return
        end
        local decoded = fromJSON(responseData or "")
        if type(decoded) ~= "table" or type(decoded.grants) ~= "table" then
            log("Invalid API response")
            return
        end
        for _, grant in ipairs(decoded.grants) do
            local ok, err = applyGrant(grant)
            if ok then
                acknowledge(grant.orderId)
            else
                log("Grant pending " .. tostring(grant.orderId) .. ": " .. tostring(err))
            end
        end
    end)
end

addEventHandler("onResourceStart", resourceRoot, function()
    if not DarkCityShop.apiBase:match("^https://") then
        log("WARNING: configure apiBase with HTTPS before production use")
    end
    if DarkCityShop.apiToken == "CHANGE_THIS_TO_THE_SAME_LONG_RANDOM_TOKEN" then
        log("ERROR: configure apiToken before starting this resource")
        return
    end
    setTimer(pollApprovedOrders, 3000, 1)
    setTimer(pollApprovedOrders, DarkCityShop.pollInterval, 0)
    log("Bridge started; polling every " .. tostring(DarkCityShop.pollInterval) .. " ms")
end)
