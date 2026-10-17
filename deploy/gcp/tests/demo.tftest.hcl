mock_provider "google" {}
mock_provider "google-beta" {}
mock_provider "random" {}

run "small_demo_has_cost_and_identity_controls" {
  command = plan
  variables {
    billing_account_id = "000000-000000-000000"
    alert_email        = "alerts@example.test"
    deploy_runtime     = true
    image              = "us-central1-docker.pkg.dev/aidscaler/aidscaler/platform:test"
    kubernetes_jwks    = "{\"keys\":[]}"
  }
  assert {
    condition     = google_cloud_run_v2_service.api[0].template[0].scaling[0].min_instance_count == 0
    error_message = "The demo must be able to scale to zero."
  }
  assert {
    condition     = google_cloud_run_v2_service.api[0].template[0].scaling[0].max_instance_count == 1
    error_message = "The initial demo must not autoscale without a reviewed increase."
  }
  assert {
    condition     = google_sql_database_instance.database.settings[0].tier == "db-g1-small" && !google_sql_database_instance.database.settings[0].disk_autoresize
    error_message = "Database compute and disk must remain bounded."
  }
  assert {
    condition     = google_billing_budget.infrastructure[0].amount[0].specified_amount[0].units == "100"
    error_message = "The infrastructure safety budget must be USD 100."
  }
  assert {
    condition     = !contains(google_billing_budget.infrastructure[0].budget_filter[0].services, "services/C7E2-9256-1C43")
    error_message = "Gemini consumption must be accounted separately."
  }
  assert {
    condition     = google_storage_bucket.files.public_access_prevention == "enforced"
    error_message = "Evidence must remain private."
  }
  assert {
    condition     = google_iam_workload_identity_pool_provider.kubernetes.attribute_condition == "assertion.sub == 'system:serviceaccount:aidscaler:aidscaler-simulator'"
    error_message = "Federation must be restricted to the simulator service account."
  }
}
