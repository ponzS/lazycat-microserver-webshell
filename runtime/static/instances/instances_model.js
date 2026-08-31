export const instanceSelector = (item) => {
  const explicitSelector = String(item?.selector || item?.target || "").trim();
  if (explicitSelector) {
    return explicitSelector;
  }
  const clientInstanceID = String(item?.client_instance_id || "").trim();
  if (clientInstanceID) {
    return `client:${clientInstanceID}`;
  }
  const name = String(item?.name || "").trim();
  const ownerDeployID = String(item?.owner_deploy_id || "").trim();
  if (!name || !ownerDeployID) {
    return "";
  }
  return `${name}@${ownerDeployID}`;
};

export const instanceDisplayName = (item) => (
  String(item?.name || "").trim() || instanceSelector(item).split("@", 1)[0]
);

export const isClientInstanceName = (name = "") => (
  String(name || "").trim().startsWith("client:")
);

export const isRunningInstance = (item) => item?.status === "running";

export const readInstanceTargetName = (searchParams) => (
  String(searchParams?.get?.("target") || searchParams?.get?.("name") || "").trim()
);

export const findInstanceBySelector = (instances, selector) => {
  const normalized = String(selector || "").trim();
  return (Array.isArray(instances) ? instances : [])
    .find((item) => instanceSelector(item) === normalized) || null;
};

export const firstRunningInstanceSelector = (instances) => (
  instanceSelector((Array.isArray(instances) ? instances : []).find(isRunningInstance))
);
