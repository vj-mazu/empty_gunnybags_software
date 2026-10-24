from django.db import models
from django.contrib.auth.models import User
from django.core.validators import RegexValidator
from django.utils import timezone
from decimal import Decimal

phone_validator = RegexValidator(
    regex=r'^[6-9]\d{9}$',
    message="Phone number must be exactly 10 digits starting with 6, 7, 8, or 9."
)

class Role(models.TextChoices):
    OWNER = 'OWNER', 'Owner'
    STAFF = 'STAFF', 'Staff'

class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.STAFF)

    def __str__(self):
        return f"{self.user.username} ({self.role})"

class Place(models.Model):
    name = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

class Floor(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

class Party(models.Model):
    name = models.CharField(max_length=150, unique=True)
    shortcut_name = models.CharField(max_length=50, blank=True, null=True)
    phone_number = models.CharField(max_length=10, validators=[phone_validator], blank=True, null=True)
    place = models.ForeignKey(Place, on_delete=models.SET_NULL, null=True, blank=True, related_name='parties')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.shortcut_name or 'No Shortcut'})"

def variety_photo_upload_path(instance, filename):
    import uuid, os
    ext = os.path.splitext(filename)[1].lower() or '.jpg'
    return f"varieties/{uuid.uuid4().hex[:12]}{ext}"

class Variety(models.Model):
    name = models.CharField(max_length=150, unique=True)
    photo = models.ImageField(upload_to=variety_photo_upload_path, max_length=500, blank=True, null=True)
    photo_data = models.TextField(blank=True, null=True, help_text="Base64 image data for permanent cloud database storage")
    kgs_per_bag = models.DecimalField(max_digits=8, decimal_places=2, help_text="Mandatory standard Kgs per bag")
    order_placed = models.BooleanField(default=False, help_text="True if empty bags order has been placed by owner")
    order_date = models.DateField(null=True, blank=True, help_text="Date when bag order was placed")
    order_bags = models.PositiveIntegerField(null=True, blank=True, help_text="Number of empty bags ordered")
    order_notes = models.CharField(max_length=255, blank=True, null=True, help_text="Supplier, printer, or order notes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'Varieties'

    def __str__(self):
        return f"{self.name} ({self.kgs_per_bag} kg/bag)"

class Inward(models.Model):
    sl_no = models.IntegerField(unique=True, editable=False)
    invoice_no = models.CharField(max_length=50, unique=True)
    date = models.DateField(default=timezone.now)
    party = models.ForeignKey(Party, on_delete=models.PROTECT, related_name='inwards')
    variety = models.ForeignKey(Variety, on_delete=models.PROTECT, related_name='inwards')
    floor = models.ForeignKey(Floor, on_delete=models.SET_NULL, null=True, blank=True, related_name='inwards')
    floor_allocations = models.JSONField(default=list, blank=True, null=True, help_text="Multi-floor allocation list")
    rate = models.DecimalField(max_digits=10, decimal_places=2)
    bags = models.PositiveIntegerField()
    total_kgs = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), editable=False)
    lf_toggle = models.BooleanField(default=False, verbose_name="LF Toggle (Yes/No)")
    lf_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), help_text="Total LF charge amount entered directly by the user")
    total_value = models.DecimalField(max_digits=14, decimal_places=2, editable=False)
    per_bag_cost = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), editable=False, help_text="Auto-calculated actual cost per bag")
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='inward_entries')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-id']
        indexes = [
            models.Index(fields=['variety', '-date', '-id']),
            models.Index(fields=['party', '-date']),
            models.Index(fields=['-date']),
            models.Index(fields=['date', 'variety']),
            models.Index(fields=['created_by']),
        ]

    def save(self, *args, **kwargs):
        if not self.sl_no:
            from django.db import transaction
            with transaction.atomic():
                last = Inward.objects.select_for_update().order_by('-sl_no').values_list('sl_no', flat=True).first()
                self.sl_no = (last or 0) + 1
        
        self.total_kgs = Decimal(str(self.bags)) * Decimal(str(self.variety.kgs_per_bag))
        base_rate = Decimal(str(self.rate or '0.00'))
        base_val = Decimal(str(self.bags)) * base_rate
        if self.lf_toggle:
            self.total_value = base_val + Decimal(str(self.lf_amount or '0.00'))
        else:
            self.total_value = base_val

        if self.bags > 0 and self.total_value > 0:
            self.per_bag_cost = self.total_value / Decimal(str(self.bags))
        else:
            self.per_bag_cost = Decimal('0.00')
            
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Inward #{self.sl_no} - {self.invoice_no} ({self.variety.name})"

class Outward(models.Model):
    sl_no = models.IntegerField(unique=True, editable=False)
    invoice_no = models.CharField(max_length=50, unique=True)
    date = models.DateField(default=timezone.now)
    party = models.ForeignKey(Party, on_delete=models.SET_NULL, null=True, blank=True, related_name='outwards')
    variety = models.ForeignKey(Variety, on_delete=models.PROTECT, related_name='outwards')
    floor = models.ForeignKey(Floor, on_delete=models.SET_NULL, null=True, blank=True, related_name='outwards')
    floor_allocations = models.JSONField(default=list, blank=True, null=True, help_text="Multi-floor allocation list")
    rate = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'), blank=True)
    bags = models.PositiveIntegerField()
    total_kgs = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), editable=False)
    lf_toggle = models.BooleanField(default=False, verbose_name="LF Toggle (Yes/No)")
    lf_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), help_text="Total LF charge amount entered directly by the user")
    is_transfer = models.BooleanField(default=False, verbose_name="Transfer Toggle (Yes/No)")
    from_place = models.ForeignKey(Place, on_delete=models.SET_NULL, null=True, blank=True, related_name='source_outwards')
    from_place_name = models.CharField(max_length=150, blank=True, null=True, help_text="Origin place name (manual entry)")
    to_place = models.ForeignKey(Place, on_delete=models.SET_NULL, null=True, blank=True, related_name='transfer_outwards')
    remarks = models.CharField(max_length=255, blank=True, null=True, default='', help_text="Transfer notes / vehicle number / remarks")
    total_value = models.DecimalField(max_digits=14, decimal_places=2, editable=False)
    per_bag_cost = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), editable=False, help_text="Auto-calculated actual cost per bag")
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='outward_entries')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-id']
        indexes = [
            models.Index(fields=['variety', '-date', '-id']),
            models.Index(fields=['party', '-date']),
            models.Index(fields=['-date']),
            models.Index(fields=['date', 'variety']),
            models.Index(fields=['created_by']),
            models.Index(fields=['to_place', '-date']),
        ]

    def save(self, *args, **kwargs):
        if not self.sl_no:
            from django.db import transaction
            with transaction.atomic():
                last = Outward.objects.select_for_update().order_by('-sl_no').values_list('sl_no', flat=True).first()
                self.sl_no = (last or 0) + 1

        self.total_kgs = Decimal(str(self.bags)) * Decimal(str(self.variety.kgs_per_bag))
        base_rate = Decimal(str(self.rate or '0.00'))
        base_val = Decimal(str(self.bags)) * base_rate
        if self.lf_toggle:
            self.total_value = base_val + Decimal(str(self.lf_amount or '0.00'))
        else:
            self.total_value = base_val

        if self.bags > 0 and self.total_value > 0:
            self.per_bag_cost = self.total_value / Decimal(str(self.bags))
        else:
            self.per_bag_cost = Decimal('0.00')

        super().save(*args, **kwargs)

    def __str__(self):
        return f"Outward #{self.sl_no} - {self.invoice_no} ({self.variety.name})"

class DailyStockSummary(models.Model):
    variety = models.ForeignKey(Variety, on_delete=models.CASCADE, related_name='daily_summaries')
    date = models.DateField()
    opening_bags = models.IntegerField(default=0)
    inward_bags = models.IntegerField(default=0)
    outward_bags = models.IntegerField(default=0)
    closing_bags = models.IntegerField(default=0)
    opening_kgs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    inward_kgs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    outward_kgs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    closing_kgs = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        ordering = ['-date', 'variety__name']
        unique_together = ('variety', 'date')

class ApprovalRequest(models.Model):
    ACTION_CHOICES = [
        ('EDIT', 'Edit'),
        ('DELETE', 'Delete'),
    ]
    MODEL_CHOICES = [
        ('INWARD', 'Inward'),
        ('OUTWARD', 'Outward'),
    ]
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    ]

    action_type = models.CharField(max_length=10, choices=ACTION_CHOICES)
    target_model = models.CharField(max_length=10, choices=MODEL_CHOICES)
    target_id = models.IntegerField()
    proposed_data = models.JSONField(blank=True, null=True)
    requested_by = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True, related_name='approval_requests')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.action_type} Request on {self.target_model} #{self.target_id} by {self.requested_by.username} ({self.status})"


def calculate_floor_stock(floor_id, variety=None, exclude_outward_id=None):
    """
    Calculates live available bags on a specific floor (or unassigned if floor_id is None).
    Accurately supports both single-floor records and multi-floor split allocations.
    """
    in_qs = Inward.objects.all()
    out_qs = Outward.objects.filter(from_place__isnull=True)

    if variety:
        if isinstance(variety, int) or isinstance(variety, str):
            in_qs = in_qs.filter(variety_id=variety)
            out_qs = out_qs.filter(variety_id=variety)
        else:
            in_qs = in_qs.filter(variety=variety)
            out_qs = out_qs.filter(variety=variety)

    if exclude_outward_id:
        out_qs = out_qs.exclude(id=exclude_outward_id)

    tot_in = 0
    for inward in in_qs.only('bags', 'floor_id', 'floor_allocations'):
        allocs = inward.floor_allocations
        if allocs and isinstance(allocs, list) and len(allocs) > 0:
            for item in allocs:
                if str(item.get('floor_id')) == str(floor_id):
                    tot_in += int(item.get('bags', 0) or 0)
        elif str(inward.floor_id) == str(floor_id):
            tot_in += inward.bags

    tot_out = 0
    for outward in out_qs.only('bags', 'floor_id', 'floor_allocations'):
        allocs = outward.floor_allocations
        if allocs and isinstance(allocs, list) and len(allocs) > 0:
            for item in allocs:
                if str(item.get('floor_id')) == str(floor_id):
                    tot_out += int(item.get('bags', 0) or 0)
        elif str(outward.floor_id) == str(floor_id):
            tot_out += outward.bags

    return tot_in - tot_out
