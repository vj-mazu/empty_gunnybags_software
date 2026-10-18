from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile, Place, Floor, Party, Variety, Inward, Outward, DailyStockSummary, Role, calculate_floor_stock
from django.db.models import Sum, Count, Q


class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username')
    email = serializers.EmailField(source='user.email', required=False, allow_blank=True)
    role = serializers.CharField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = UserProfile
        fields = ['id', 'user_id', 'username', 'email', 'role', 'can_delete']

    def get_can_delete(self, obj):
        # Use prefetched counts if available (set by view), otherwise single query
        if hasattr(obj, '_inward_count') and hasattr(obj, '_outward_count'):
            return (obj._inward_count + obj._outward_count) == 0
        inward_cnt = Inward.objects.filter(created_by=obj.user).count()
        outward_cnt = Outward.objects.filter(created_by=obj.user).count()
        return (inward_cnt + outward_cnt) == 0


class PlaceSerializer(serializers.ModelSerializer):
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = Place
        fields = ['id', 'name', 'created_at', 'can_delete']

    def get_can_delete(self, obj):
        if hasattr(obj, '_party_count'):
            return obj._party_count == 0
        return obj.parties.count() == 0


class FloorSerializer(serializers.ModelSerializer):
    can_delete = serializers.SerializerMethodField()
    total_bags = serializers.SerializerMethodField()

    class Meta:
        model = Floor
        fields = ['id', 'name', 'description', 'created_at', 'can_delete', 'total_bags']

    def get_can_delete(self, obj):
        return (obj.inwards.count() + obj.outwards.count()) == 0

    def get_total_bags(self, obj):
        return calculate_floor_stock(obj.id)


class PartySerializer(serializers.ModelSerializer):
    place_name = serializers.ReadOnlyField(source='place.name')
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = Party
        fields = ['id', 'name', 'shortcut_name', 'phone_number', 'place', 'place_name', 'created_at', 'can_delete']

    def get_can_delete(self, obj):
        if hasattr(obj, '_inward_count') and hasattr(obj, '_outward_count'):
            return (obj._inward_count + obj._outward_count) == 0
        return (obj.inwards.count() + obj.outwards.count()) == 0


class VarietySerializer(serializers.ModelSerializer):
    current_stock_bags = serializers.SerializerMethodField()
    current_stock_kgs = serializers.SerializerMethodField()
    our_mill_stock_bags = serializers.SerializerMethodField()
    our_mill_stock_kgs = serializers.SerializerMethodField()
    other_places_stock_bags = serializers.SerializerMethodField()
    other_places_stock_kgs = serializers.SerializerMethodField()
    other_places_breakdown = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Variety
        fields = [
            'id', 'name', 'photo', 'photo_data', 'photo_url', 'kgs_per_bag',
            'order_placed', 'order_date', 'order_bags', 'order_notes',
            'created_at', 'current_stock_bags', 'current_stock_kgs',
            'our_mill_stock_bags', 'our_mill_stock_kgs',
            'other_places_stock_bags', 'other_places_stock_kgs',
            'other_places_breakdown', 'can_delete'
        ]

    def get_photo_url(self, obj):
        if obj.photo_data:
            return obj.photo_data
        if obj.photo:
            try:
                return obj.photo.url
            except Exception:
                return None
        return None

    def get_our_mill_stock_bags(self, obj):
        if hasattr(obj, '_our_mill_bags'):
            return obj._our_mill_bags or 0
        tot = self.get_current_stock_bags(obj)
        other = self.get_other_places_stock_bags(obj)
        return max(0, tot - other)

    def get_our_mill_stock_kgs(self, obj):
        return float(self.get_our_mill_stock_bags(obj)) * float(obj.kgs_per_bag)

    def get_other_places_stock_bags(self, obj):
        if hasattr(obj, '_other_places_bags'):
            return obj._other_places_bags or 0
        tr_in = Outward.objects.filter(variety=obj, is_transfer=True, to_place__isnull=False).aggregate(Sum('bags'))['bags__sum'] or 0
        tr_out = Outward.objects.filter(variety=obj, from_place__isnull=False).aggregate(Sum('bags'))['bags__sum'] or 0
        return max(0, tr_in - tr_out)

    def get_other_places_stock_kgs(self, obj):
        return float(self.get_other_places_stock_bags(obj)) * float(obj.kgs_per_bag)

    def get_other_places_breakdown(self, obj):
        if hasattr(obj, '_other_places_breakdown'):
            return obj._other_places_breakdown or []
        tr_qs = Outward.objects.filter(variety=obj, is_transfer=True, to_place__isnull=False).values('to_place_id', 'to_place__name').annotate(s=Sum('bags'))
        out_qs = Outward.objects.filter(variety=obj, from_place__isnull=False).values('from_place_id').annotate(s=Sum('bags'))
        out_map = {item['from_place_id']: (item['s'] or 0) for item in out_qs}
        breakdown = []
        for item in tr_qs:
            pid = item['to_place_id']
            pname = item['to_place__name'] or f"Place #{pid}"
            bal = (item['s'] or 0) - out_map.get(pid, 0)
            if bal > 0:
                breakdown.append({'place_id': pid, 'place_name': pname, 'bags': bal})
        return breakdown

    def get_current_stock_bags(self, obj):
        # Use prefetched annotation if available (set by view), otherwise fallback
        if hasattr(obj, '_total_stock_bags'):
            return obj._total_stock_bags or 0
        in_b = Inward.objects.filter(variety=obj).aggregate(Sum('bags'))['bags__sum'] or 0
        sales_b = Outward.objects.filter(variety=obj, is_transfer=False).aggregate(Sum('bags'))['bags__sum'] or 0
        other = self.get_other_places_stock_bags(obj)
        our_mill = max(0, (in_b - sales_b) - other)
        return our_mill + other

    def get_current_stock_kgs(self, obj):
        stock_bags = self.get_current_stock_bags(obj)
        return float(stock_bags) * float(obj.kgs_per_bag)

    def get_can_delete(self, obj):
        if hasattr(obj, '_inward_count') and hasattr(obj, '_outward_count'):
            return (obj._inward_count + obj._outward_count) == 0
        return (obj.inwards.count() + obj.outwards.count()) == 0


class InwardSerializer(serializers.ModelSerializer):
    party_name = serializers.ReadOnlyField(source='party.name')
    variety_name = serializers.ReadOnlyField(source='variety.name')
    floor_name = serializers.ReadOnlyField(source='floor.name')
    kgs_per_bag = serializers.ReadOnlyField(source='variety.kgs_per_bag')
    created_by_name = serializers.ReadOnlyField(source='created_by.username')

    class Meta:
        model = Inward
        fields = [
            'id', 'sl_no', 'invoice_no', 'date', 'party', 'party_name', 
            'variety', 'variety_name', 'floor', 'floor_name', 'floor_allocations', 'kgs_per_bag', 'rate', 'bags', 
            'total_kgs', 'lf_toggle', 'lf_amount', 'total_value', 'per_bag_cost', 'created_by', 'created_by_name', 'created_at'
        ]

    def validate(self, data):
        floor_allocations = data.get('floor_allocations')
        total_bags = data.get('bags', 0)
        if floor_allocations and isinstance(floor_allocations, list) and len(floor_allocations) > 0:
            alloc_sum = sum(int(item.get('bags', 0) or 0) for item in floor_allocations)
            if alloc_sum != total_bags:
                raise serializers.ValidationError({
                    "floor_allocations": f"Total allocated floor bags ({alloc_sum}) must exactly equal total inward bags ({total_bags})!"
                })
        return data


class OutwardSerializer(serializers.ModelSerializer):
    party_name = serializers.ReadOnlyField(source='party.name')
    variety_name = serializers.ReadOnlyField(source='variety.name')
    floor_name = serializers.ReadOnlyField(source='floor.name')
    kgs_per_bag = serializers.ReadOnlyField(source='variety.kgs_per_bag')
    to_place_name = serializers.ReadOnlyField(source='to_place.name')
    created_by_name = serializers.ReadOnlyField(source='created_by.username')

    class Meta:
        model = Outward
        fields = [
            'id', 'sl_no', 'invoice_no', 'date', 'party', 'party_name', 
            'variety', 'variety_name', 'floor', 'floor_name', 'floor_allocations', 'kgs_per_bag', 'rate', 'bags', 
            'total_kgs', 'lf_toggle', 'lf_amount', 'is_transfer', 
            'from_place', 'from_place_name', 'to_place', 'to_place_name', 'total_value', 
            'per_bag_cost', 'created_by', 'created_by_name', 'created_at'
        ]

    def validate(self, data):
        variety = data.get('variety')
        requested_bags = data.get('bags', 0)
        from_place = data.get('from_place')
        is_transfer = data.get('is_transfer', False)

        # 1. Total Mill-Wide Stock Validation
        in_bags = Inward.objects.filter(variety=variety).aggregate(Sum('bags'))['bags__sum'] or 0
        out_bags = Outward.objects.filter(variety=variety).aggregate(Sum('bags'))['bags__sum'] or 0
        
        if self.instance and self.instance.variety == variety:
            out_bags -= self.instance.bags

        available_stock = in_bags - out_bags
        if in_bags == 0:
            raise serializers.ValidationError({
                "bags": f"No inward stock exists for variety '{variety.name}'! Total inwarded stock is 0 bags. Cannot create outward entry."
            })
        if requested_bags > available_stock:
            raise serializers.ValidationError({
                "bags": f"Insufficient stock! Available total stock for '{variety.name}' is only {available_stock} bags. Cannot fulfill outward request of {requested_bags} bags."
            })

        # 2. Branch-Specific Location Stock Validation (when selling from a Branch)
        if not is_transfer and from_place:
            branch_in = Outward.objects.filter(is_transfer=True, to_place=from_place, variety=variety).aggregate(Sum('bags'))['bags__sum'] or 0
            branch_out = Outward.objects.filter(from_place=from_place, variety=variety).aggregate(Sum('bags'))['bags__sum'] or 0

            if self.instance and self.instance.from_place == from_place and self.instance.variety == variety:
                branch_out -= self.instance.bags

            branch_available = branch_in - branch_out

            if branch_in == 0:
                raise serializers.ValidationError({
                    "bags": f"No inward/transferred stock exists at branch '{from_place.name}' for variety '{variety.name}'! (Transferred: 0 bags). Cannot make a location sale."
                })
            if requested_bags > branch_available:
                raise serializers.ValidationError({
                    "bags": f"Insufficient branch stock! Branch '{from_place.name}' only has {branch_available} bags of '{variety.name}' remaining. Cannot dispatch {requested_bags} bags."
                })

        # 3. Floor-Specific Stock Validation (when selling or transferring from Mother India)
        if not from_place:
            floor_allocations = data.get('floor_allocations')
            single_floor = data.get('floor')

            if floor_allocations and isinstance(floor_allocations, list) and len(floor_allocations) > 0:
                alloc_sum = sum(int(item.get('bags', 0) or 0) for item in floor_allocations)
                if alloc_sum != requested_bags:
                    raise serializers.ValidationError({
                        "floor_allocations": f"Total allocated floor bags ({alloc_sum}) must exactly equal total outward bags ({requested_bags})!"
                    })
                for item in floor_allocations:
                    f_id = item.get('floor_id')
                    alloc_b = int(item.get('bags', 0) or 0)
                    if f_id and alloc_b > 0:
                        fl_obj = Floor.objects.filter(id=f_id).first()
                        fl_name = fl_obj.name if fl_obj else f"Floor #{f_id}"
                        avail = calculate_floor_stock(f_id, variety=variety, exclude_outward_id=self.instance.id if self.instance else None)
                        if alloc_b > avail:
                            raise serializers.ValidationError({
                                "floor_allocations": f"Insufficient stock on '{fl_name}'! Only {avail} bags available for '{variety.name}', but {alloc_b} bags requested."
                            })
            elif single_floor:
                avail = calculate_floor_stock(single_floor.id, variety=variety, exclude_outward_id=self.instance.id if self.instance else None)
                if requested_bags > avail:
                    raise serializers.ValidationError({
                        "bags": f"Insufficient stock on '{single_floor.name}'! Only {avail} bags available for '{variety.name}', but {requested_bags} bags requested."
                    })

        return data


class DailyStockSummarySerializer(serializers.ModelSerializer):
    variety_name = serializers.ReadOnlyField(source='variety.name')

    class Meta:
        model = DailyStockSummary
        fields = [
            'id', 'variety', 'variety_name', 'date', 
            'opening_bags', 'inward_bags', 'outward_bags', 'closing_bags',
            'opening_kgs', 'inward_kgs', 'outward_kgs', 'closing_kgs'
        ]


from .models import ApprovalRequest, Inward, Outward

class ApprovalRequestSerializer(serializers.ModelSerializer):
    requested_by_username = serializers.ReadOnlyField(source='requested_by.username')
    target_details = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            'id', 'action_type', 'target_model', 'target_id', 
            'proposed_data', 'target_details', 'requested_by', 'requested_by_username', 
            'status', 'created_at', 'reviewed_at'
        ]
        read_only_fields = ['requested_by']

    def get_target_details(self, obj):
        try:
            if obj.target_model == 'INWARD':
                item = Inward.objects.filter(pk=obj.target_id).select_related('party', 'variety').first()
                if item:
                    return {
                        'invoice_no': item.invoice_no,
                        'party_name': item.party.name if item.party else '-',
                        'variety_name': item.variety.name if item.variety else '-',
                        'bags': item.bags,
                        'rate': str(item.rate),
                        'total_value': str(item.total_value),
                        'date': str(item.date)
                    }
            elif obj.target_model == 'OUTWARD':
                item = Outward.objects.filter(pk=obj.target_id).select_related('party', 'variety').first()
                if item:
                    return {
                        'invoice_no': item.invoice_no,
                        'party_name': item.party.name if item.party else '-',
                        'variety_name': item.variety.name if item.variety else '-',
                        'bags': item.bags,
                        'rate': str(item.rate),
                        'total_value': str(item.total_value),
                        'date': str(item.date)
                    }
        except Exception:
            pass
        return None
